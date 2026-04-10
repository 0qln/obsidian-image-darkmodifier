import {
	App,
	FileSystemAdapter,
	Plugin,
	PluginSettingTab,
	requestUrl,
	Setting,
	TFile,
	Platform,
} from "obsidian";
import * as path from "path";
import { Image } from "image-js";
import { ImageCache, ImageInfo, RemoteImageInfo } from "ImageCache";
import { ImageFilter } from "filters/ImageFilter";
import { InvertFilterName, InvertFilter } from "filters/InvertFilter";
import {
	TransparentFilterName,
	TransparentFilter,
	ThresholdParamRemove,
	ThresholdParamRemoveName,
	ThresholdParamColorName,
} from "filters/TransparentFilter";
import {
	BoostLightnessFilterName,
	BoostLightnessFilter,
	BoostLightnessParamAmountName,
} from "filters/BoostLightnessFilter";
import Color from "color";
import { DarkModeFilter, DarkModeFilterName } from "filters/DarkModeFilter";
import { FilterInputOutput } from "filters/FilterInputOutput";
import { Logger } from "Logger";
import {
	ContrastAmountParamName,
	ContrastFilter,
	ContrastFilterName,
} from "filters/ContrastFilter";
import {
	SharpnessAmountParamName,
	SharpnessFilter,
	SharpnessFilterName,
} from "filters/SharpnessFilter";

interface ImageDarkmodifierPluginSettings {
	cacheDir: string;
	imgSelector: string;
	debug: boolean;
	themeAware: boolean;
}

const DEFAULT_SETTINGS: ImageDarkmodifierPluginSettings = {
	cacheDir: path.join(".cache", "image-darkmodifier"),
	imgSelector: "img",
	debug: false,
	themeAware: false,
};

export default class ImageDarkmodifierPlugin extends Plugin {
	settings: ImageDarkmodifierPluginSettings;
	private observer: MutationObserver;
	private themeObserver: MutationObserver;
	private cache: ImageCache;
	private logger: Logger;
	private remoteObserver: IntersectionObserver | null = null;
	private pendingRemoteImages = new Set<HTMLImageElement>();
	private queuedImages = new Set<HTMLImageElement>();
	private queueTimer: number | null = null;
	private fileModifyTimer: number | null = null;
	private pendingModifiedPaths = new Set<string>();
	private filterFactoryCache = new Map<string, Array<() => ImageFilter>>();
	private inFlight = new Map<string, Promise<void>>();

	getVaultPath(): string | null {
		let adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return null;
	}

	getCurrentTheme(): "light" | "dark" {
		// Check multiple sources for theme information
		const bodyTheme = document.body.dataset.theme;
		const bodyClass = document.body.className;

		this.logger.log("[  THEME  ]   body.dataset.theme:", bodyTheme);
		this.logger.log("[  THEME  ]   body.className:", bodyClass);

		// [COMPAT: Encore Theme + Style Settings Plugin]
		// seems to use `encore-theme-light-...` and `encore-theme-dark-...`
		// regardless of whether the current theme is actually dark or light.
		// So split here to get the full classnames instead of searching the string
		// by simply `theme-light` or `theme-dark`.
		const bodyClasses = bodyClass.split(" ");

		// Obsidian uses 'theme-light' and 'theme-dark' classes
		if (bodyClasses.includes("theme-light")) {
			return "light";
		}
		if (bodyClasses.includes("theme-dark")) {
			return "dark";
		}

		// Fallback to dataset
		return bodyTheme === "light" ? "light" : "dark";
	}

	async onload() {
		await this.loadSettings();

		this.logger = new Logger(() => this.settings.debug);
		this.cache = new ImageCache(
			this.getVaultPath() || "",
			this.settings.cacheDir,
			this.logger,
		);
		this.setupRemoteObserver();

		this.observer = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				mutation.addedNodes.forEach((n) => this.processNode(n));
			});
		});

		this.observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: false,
			characterData: false,
		});

		// Watch for theme changes (both data-theme and class attributes)
		this.themeObserver = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				if (
					mutation.type === "attributes" &&
					(mutation.attributeName === "data-theme" ||
						mutation.attributeName === "class")
				) {
					if (this.settings.themeAware) {
						const currentTheme = this.getCurrentTheme();
						this.logger.log(
							"[  THEME CHANGE  ]   Theme changed to:",
							currentTheme,
						);
						this.processAllImgs();
					}
				}
			});
		});

		this.themeObserver.observe(document.body, {
			attributes: true,
			attributeFilter: ["data-theme", "class"],
		});

		// Re-process when switching between modes
		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.processAllImgs()),
		);

		// Re-process only images that depend on modified files.
		this.registerEvent(
			this.app.vault.on("modify", (f) => {
				if (!(f instanceof TFile)) {
					return;
				}
				this.pendingModifiedPaths.add(this.normalizePath(f.path));
				this.scheduleModifiedFileRefresh();
			}),
		);

		this.addSettingTab(
			new ImageDarkmodifierPluginSettingsTab(this.app, this),
		);
	}

	processAllImgs() {
		const imgs = document.querySelectorAll(this.settings.imgSelector);
		imgs.forEach((img) => this.enqueueImage(img as HTMLImageElement));
	}

	private processNode(node: Node) {
		if (node instanceof HTMLImageElement && node.matches(this.settings.imgSelector)) {
			this.enqueueImage(node);
			return;
		}
		if (node instanceof Element) {
			const imgs = node.querySelectorAll(this.settings.imgSelector);
			imgs.forEach((img) => this.enqueueImage(img as HTMLImageElement));
		}
	}

	private enqueueImage(img: HTMLImageElement) {
		if (!img.isConnected) {
			return;
		}
		this.queuedImages.add(img);
		if (this.queueTimer !== null) {
			return;
		}
		this.queueTimer = window.setTimeout(() => {
			this.queueTimer = null;
			const batch = Array.from(this.queuedImages);
			this.queuedImages.clear();
			this.scheduleIdle(() => {
				batch.forEach((queuedImg) => {
					void this.processImg(queuedImg);
				});
			});
		}, 60);
	}

	private scheduleIdle(fn: () => void) {
		const ric = (window as Window & {
			requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
		}).requestIdleCallback;
		if (ric) {
			ric(fn, { timeout: 250 });
			return;
		}
		window.setTimeout(fn, 0);
	}

	private setupRemoteObserver() {
		if (typeof IntersectionObserver === "undefined") {
			return;
		}
		this.remoteObserver = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (!entry.isIntersecting) {
					return;
				}
				const img = entry.target as HTMLImageElement;
				this.remoteObserver?.unobserve(img);
				this.pendingRemoteImages.delete(img);
				this.enqueueImage(img);
			});
		}, { rootMargin: "200px" });
	}

	private scheduleModifiedFileRefresh() {
		if (this.fileModifyTimer !== null) {
			return;
		}
		this.fileModifyTimer = window.setTimeout(() => {
			this.fileModifyTimer = null;
			const changed = new Set(this.pendingModifiedPaths);
			this.pendingModifiedPaths.clear();
			this.refreshImgsForModifiedFiles(changed);
		}, 150);
	}

	private refreshImgsForModifiedFiles(changedPaths: Set<string>) {
		if (!changedPaths.size) {
			return;
		}
		const imgs = document.querySelectorAll(this.settings.imgSelector);
		imgs.forEach((img) => {
			const htmlImg = img as HTMLImageElement;
			const originalSrc = htmlImg.getAttr("original-src") || htmlImg.src;
			const localPath = this.getLocalPathFromSrc(originalSrc);
			if (!localPath) {
				return;
			}
			if (changedPaths.has(this.normalizePath(localPath))) {
				this.enqueueImage(htmlImg);
			}
		});
	}

	private normalizePath(p: string): string {
		const normalized = p.replace(/\\/g, "/");
		return Platform.isWin ? normalized.toLowerCase() : normalized;
	}

	private getLocalPathFromSrc(src: string): string | null {
		try {
			const url = new URL(src);
			if (url.protocol !== "app:") {
				return null;
			}
			const vaultPath = this.getVaultPath() || "";
			const pathname = Platform.isWin
				? url.pathname.replace(/^\//, "")
				: url.pathname;
			const relative = path.relative(vaultPath, pathname);
			return decodeURIComponent(relative.replace(/\\/g, "/"));
		} catch {
			return null;
		}
	}

	private isLikelyVisible(img: HTMLImageElement): boolean {
		const rect = img.getBoundingClientRect();
		return rect.bottom >= -200 && rect.top <= window.innerHeight + 200;
	}

	private getFiltersForAlt(alt: string): Array<ImageFilter> {
		const cached = this.filterFactoryCache.get(alt);
		if (cached) {
			return cached.map((factory) => factory());
		}

		const factories: Array<() => ImageFilter> =
			(alt
				.match(/@[-\w]+(\((\){2}|[^)]{1,2})*\))?/gm)
				?.map((filter) => {
					const name = filter.match(/(?<=@)[-\w]+/)?.[0];
					if (!name) return false;

					class OptionValue {
						number: number | undefined;
						string: string | undefined;
						boolean: boolean | undefined;

						parseStr<T>(fn: (x: string) => T): T | undefined {
							return this.string === undefined ? undefined : fn(this.string);
						}

						constructor(
							int: number | undefined,
							float: number | undefined,
							string: string | undefined,
						) {
							this.number =
								int !== undefined
									? int
									: float !== undefined
										? float
										: undefined;
							this.string = string;
							this.boolean = this.number === undefined && this.string === undefined;
						}
					}

					const options = new Map<string, OptionValue | undefined>(
						filter
							.match(
								/(?<=\(\s*|,\s*)[-\w]+(\s*=\s*((-?[\.\d]+)|((\"([^"()]{1,2}|\({2}|\){2}|\"{2})*\"))))?(?=.*\))/g,
							)
							?.map((option) => {
								const key = option.match(/^[-_\w]+/)?.[0];
								if (!key) return ["<invalid>", undefined];

								const intValue = option.match(/(?<=\s*=\s*)-?\d+$/)?.[0];
								const floatValue = option.match(/(?<=\s*=\s*)-?\d*\.\d*$/)?.[0];
								const stringValue = option.match(/(?<=\s*=\s*").*(?="$)/)?.[0];

								return [
									key,
									new OptionValue(
										intValue !== undefined ? Number.parseInt(intValue) : undefined,
										floatValue !== undefined ? Number.parseFloat(floatValue) : undefined,
										stringValue
											?.replace("((", "(")
											?.replace("))", ")")
											?.replace('""', '"'),
									),
								];
							}) ?? [],
					);

					switch (name) {
						case InvertFilterName:
							return () => new InvertFilter();
						case TransparentFilterName: {
							const threshold =
								options.get(ThresholdParamColorName)?.number ??
								options
									.get(ThresholdParamColorName)
									?.parseStr((x) => Color(x));
							const remove = options.get(ThresholdParamRemoveName)?.string as ThresholdParamRemove;
							return () => new TransparentFilter(threshold, remove);
						}
						case BoostLightnessFilterName: {
							const amount = options.get(BoostLightnessParamAmountName)?.number;
							return () => new BoostLightnessFilter(amount);
						}
						case DarkModeFilterName:
							return () => new DarkModeFilter();
						case ContrastFilterName: {
							const amount = options.get(ContrastAmountParamName)?.number;
							return () => new ContrastFilter(amount);
						}
						case SharpnessFilterName: {
							const amount = options.get(SharpnessAmountParamName)?.number;
							return () => new SharpnessFilter(amount);
						}
						default:
							return false;
					}
				})
				.filter((x) => x !== false) as Array<() => ImageFilter>) ?? [];

		this.filterFactoryCache.set(alt, factories);
		return factories.map((factory) => factory());
	}

	private async processImg(
		img: HTMLImageElement,
		options?: { skipRemoteDefer?: boolean },
	) {
		this.logger.log("[  PROCESS IMG  ]   process img: ", img);
		if (!img.isConnected) {
			return;
		}

		const alt = img.alt;
		const src = img.src;
		const originalSrc = img.getAttr("original-src") || src;
		img.setAttr("original-src", originalSrc);
		const themeKey = this.settings.themeAware ? this.getCurrentTheme() : "static";
		const inFlightKey = `${originalSrc}|${alt}|${themeKey}`;
		const existing = this.inFlight.get(inFlightKey);
		if (existing) {
			return existing;
		}

		const task = this.processImgInternal(img, alt, src, originalSrc, options).finally(() => {
			if (this.inFlight.get(inFlightKey) === task) {
				this.inFlight.delete(inFlightKey);
			}
		});
		this.inFlight.set(inFlightKey, task);
		return task;
	}

	private async processImgInternal(
		img: HTMLImageElement,
		alt: string,
		src: string,
		originalSrc: string,
		options?: { skipRemoteDefer?: boolean },
	) {
		if (!alt.includes("@")) {
			img.src = originalSrc;
			return;
		}

		const filters = this.getFiltersForAlt(alt);

		this.logger.log("[  PROCESS IMG  ]   parsed filters: ", filters);

		// Reset to the old src
		if (!filters.length) {
			img.src = originalSrc;
			this.logger.log("[  PROCESS IMG  ]   resetting src. ");
			return;
		}

		const url = new URL(originalSrc);

		if (url.protocol === "app:") {
			const unencoded = this.getLocalPathFromSrc(originalSrc);
			if (!unencoded) {
				return;
			}

			// Get the actual file
			const file = this.app.vault.getAbstractFileByPath(unencoded);
			if (!(file instanceof TFile)) {
				this.logger.error(
					"[  PROCESS IMG  ]   could not find file: ",
					unencoded,
				);
				return;
			}

			try {
				// Process image and get cache path
				const buffer = await this.app.vault.readBinary(file);
				const cachePath = await this.processImage(
					file,
					buffer,
					filters,
				);

				// update img element
				img.src = this.app.vault.getResourcePath({
					path: cachePath,
				} as TFile);

				this.logger.log("[  PROCESS IMG  ]   old src: ", src);
				this.logger.log("[  PROCESS IMG  ]   new src: ", img.src);
			} catch (error) {
				this.logger.error("[  PROCESS IMG  ]   error:", error);
			}
		} else {
			if (!options?.skipRemoteDefer && !this.isLikelyVisible(img)) {
				this.pendingRemoteImages.add(img);
				this.remoteObserver?.observe(img);
				return;
			}
			this.pendingRemoteImages.delete(img);
			this.remoteObserver?.unobserve(img);

			const info: RemoteImageInfo = {
				// use the whole url, so we don't have collisions between websites.
				path: url.toString(),
				basename: path.basename(url.pathname).replace(/\..*$/, ""),
				name: path.basename(url.pathname),
				// don't assume any modification times about remote files.
				stat: { mtime: Number.MAX_VALUE },
			};

			const response = await requestUrl(url.toString());
			const buffer = response.arrayBuffer;
			const cachePath = await this.processImage(info, buffer, filters);

			// update img element
			img.src = this.app.vault.getResourcePath({
				path: cachePath,
			} as TFile);

			this.logger.log("[  PROCESS IMG  ]   old src: ", src);
			this.logger.log("[  PROCESS IMG  ]   new src: ", img.src);
		}
	}

	private async processImage(
		file: ImageInfo,
		data: ArrayBuffer,
		filters: Array<ImageFilter>,
	): Promise<string> {
		const filterNames = filters.map((f) => f.getName());

		// Get theme if themeAware is enabled
		const theme = this.settings.themeAware
			? this.getCurrentTheme()
			: undefined;

		const cachePath = this.cache.cachePath(file, filterNames, theme);
		if (this.cache.isFresh(file, filterNames, theme)) {
			this.logger.log("[  PROCESS IMG  ]   cache hit: ", cachePath);
			return cachePath;
		}

		try {
			// Read image from the vault
			const image = await Image.load(data);

			// Apply filters with theme context
			const output = filters.reduce(
				(input, filter) => filter.processImage(input, theme),
				{ data: image, file: file } as FilterInputOutput,
			);

			// Save image
			const pngBuffer = await output.data.toBuffer({ format: "png" });
			await this.app.vault.adapter.writeBinary(cachePath, pngBuffer);

			this.logger.log("[  PROCESS IMG  ]   cache miss: ", cachePath);
			return cachePath;
		} catch (error) {
			throw new Error(`Failed to process image: ${error.message}`);
		}
	}

	clearCache() {
		this.cache.clearEntireCache();
	}

	onunload() {
		if (this.queueTimer !== null) {
			window.clearTimeout(this.queueTimer);
			this.queueTimer = null;
		}
		if (this.fileModifyTimer !== null) {
			window.clearTimeout(this.fileModifyTimer);
			this.fileModifyTimer = null;
		}
		if (this.observer) {
			this.observer.disconnect();
		}
		if (this.themeObserver) {
			this.themeObserver.disconnect();
		}
		if (this.remoteObserver) {
			this.remoteObserver.disconnect();
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ImageDarkmodifierPluginSettingsTab extends PluginSettingTab {
	plugin: ImageDarkmodifierPlugin;

	constructor(app: App, plugin: ImageDarkmodifierPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Cache directory")
			.setDesc("Where the modified images will be stored")
			.addText((text) =>
				text
					.setPlaceholder("Enter the path relative to the vault")
					.setValue(this.plugin.settings.cacheDir)
					.onChange(async (value) => {
						this.plugin.settings.cacheDir = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Clear cache")
			.setDesc("Clear the image cache")
			.addButton((button) => {
				button.onClick(() => this.plugin.clearCache());
				button.setButtonText("Clear cache");
			});

		new Setting(containerEl)
			.setName("Debug mode")
			.setDesc("Enable debug mode. This turn on things like logging.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.debug);
				toggle.onChange(async (val) => {
					this.plugin.settings.debug = val;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Theme Aware Mode")
			.setDesc(
				"When enabled, @darkmode filter adapts to current theme (light/dark). When disabled, always applies dark mode adjustments.",
			)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.themeAware);
				toggle.onChange(async (val) => {
					this.plugin.settings.themeAware = val;
					await this.plugin.saveSettings();
					// Reprocess all images when setting changes
					this.plugin.processAllImgs();
				});
			});
	}
}
