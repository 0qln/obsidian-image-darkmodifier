import { App, FileSystemAdapter, Plugin, PluginSettingTab, requestUrl, Setting, TFile } from 'obsidian';
import * as path from 'path';
import { Image } from 'image-js';
import { ImageCache, ImageInfo, RemoteImageInfo } from 'ImageCache';
import { ImageFilter } from 'filters/ImageFilter';
import { InvertFilterName, InvertFilter } from 'filters/InvertFilter';
import { TransparentFilterName, TransparentFilter, ThresholdParamRemove, ThresholdParamRemoveName, ThresholdParamColorName } from 'filters/TransparentFilter';
import { BoostLightnessFilterName, BoostLightnessFilter, BoostLightnessParamAmountName } from 'filters/BoostLightnessFilter';
import Color from 'color';
import { DarkModeFilter, DarkModeFilterName } from 'filters/DarkModeFilter';
import { FilterInputOutput } from 'filters/FilterInputOutput';
import { Logger } from 'Logger';

interface ImageDarkmodifierPluginSettings {
	cacheDir: string;
	imgSelector: string;
	debug: boolean;
}

const DEFAULT_SETTINGS: ImageDarkmodifierPluginSettings = {
	cacheDir: path.join('.cache', 'image-darkmodifier'),
	imgSelector: 'img',
	debug: false,
}

export default class ImageDarkmodifierPlugin extends Plugin {
	settings: ImageDarkmodifierPluginSettings;
	private observer: MutationObserver;
	private cache: ImageCache;
	private logger: Logger;

	getVaultPath(): string | null {
		let adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return null;
	}

	async onload() {
		await this.loadSettings();
		
		this.logger = new Logger(() => this.settings.debug);

		this.observer = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				mutation.addedNodes.forEach(n => this.processNode(n));
			});
		});

		this.observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: false,
			characterData: false
		});

		this.cache = new ImageCache(this.getVaultPath() || '', this.settings.cacheDir, this.logger);

		// Re-process when switching between modes
		this.registerEvent(
			this.app.workspace.on('layout-change', () => this.processAllImgs())
		);

		// Re-process when files are modified
		this.registerEvent(
			this.app.vault.on('modify', _f => this.processAllImgs())
		);

		this.addSettingTab(new ImageDarkmodifierPluginSettingsTab(this.app, this));
	}

	private processAllImgs() {
		const imgs = document.querySelectorAll(this.settings.imgSelector);
		imgs.forEach(img => this.processImg(img as HTMLImageElement));
	}

	private processNode(node: Node) {
		if (node instanceof HTMLImageElement && node.matches(this.settings.imgSelector)) {
			this.processImg(node);
		}
		else {
			node.childNodes.forEach(n => this.processNode(n));
		}
	}

	private async processImg(img: HTMLImageElement) {
		this.logger.log("[  PROCESS IMG  ]   process img: ", img)

		const alt = img.alt;
		const src = img.src;
		const originalSrc = img.getAttr('original-src') || src;
		img.setAttr('original-src', originalSrc);

		const filters: Array<ImageFilter> = alt.match(/@[-\w]+(\((\){2}|[^)]{1,2})*\))?/gm)?.map(filter => {
			const name = filter.match(/(?<=@)[-\w]+/)?.[0];
			if (!name) return false;
		
			// todo: escaping paranths might be annoying, better find an alternative.

			// options may look like the following:
			// option-name
			// option-name="string_value"     '(', ')', '"', '\' have to be escaped
			// option-name=42
			// option-name=4.2
			// option-name=-69
			// option-name=-6.9

			class OptionValue {
				number: number|undefined;
				string: string|undefined;
				boolean: boolean|undefined;
				
				parseStr<T>(fn: (x: string) => T): T|undefined {
					return this.string === undefined
						? undefined
						: fn(this.string);
				}
				
				constructor(
					int: number|undefined,
					float: number|undefined,
					string: string|undefined,
				) {
					// number is either int or float.
					this.number = (int !== undefined) ? int : (float !== undefined) ? float : undefined;				
					
					// string is just string.
					this.string = string;
					
					// if the other 2 param values are missing, e.g. "fn(param)", it is just a boolean true.
					this.boolean = this.number === undefined && this.string === undefined;
				}
			}

			const options = new Map<string, OptionValue|undefined>(
				filter.match(/(?<=\(\s*|,\s*)[-\w]+(\s*=\s*((-?[\.\d]+)|((\"([^"()]{1,2}|\({2}|\){2}|\"{2})*\"))))?(?=.*\))/g)
					?.map(option => {
						// get key
						const key = option.match(/^[-_\w]+/)?.[0];
						if (!key) return ["<invalid>", undefined];

						// get value
						const intValue = option.match(/(?<=\s*=\s*)-?\d+$/)?.[0];
						const floatValue = option.match(/(?<=\s*=\s*)-?\d*\.\d*$/)?.[0];
						const stringValue = option.match(/(?<=\s*=\s*").*(?="$)/)?.[0];

						return [key, new OptionValue(
							intValue !== undefined ? Number.parseInt(intValue) : undefined,
							floatValue !== undefined ? Number.parseFloat(floatValue) : undefined,
							stringValue?.replace('((', '(')?.replace('))', ')')?.replace('""', '"'),
						)];
					})
				?? []
			);

			switch (name) {
				case InvertFilterName: return new InvertFilter();
				case TransparentFilterName: return new TransparentFilter(
					options.get(ThresholdParamColorName)?.number ?? options.get(ThresholdParamColorName)?.parseStr(x => Color(x)),
					options.get(ThresholdParamRemoveName)?.string as ThresholdParamRemove
				);
				case BoostLightnessFilterName: return new BoostLightnessFilter(options.get(BoostLightnessParamAmountName)?.number);
				case DarkModeFilterName: return new DarkModeFilter();
				default: return false;
			}
		}).filter(x => x != false) ?? [];

		this.logger.log("[  PROCESS IMG  ]   parsed filters: ", filters);

		// Reset to the old src 
		if (!filters.length) {
			img.src = originalSrc;
			this.logger.log("[  PROCESS IMG  ]   resetting src. ");
			return;
		}

		const url = new URL(originalSrc);

		if (url.protocol === 'app:') {
			const vaultPath = this.getVaultPath() || '';
			const pathname = url.pathname.replace(/^\//, '');
			const originalSrcVaultPath = path.relative(vaultPath, pathname);
			const unencoded = decodeURIComponent(originalSrcVaultPath.replace(/\\/g, '/'));

			// Get the actual file
			const file = this.app.vault.getAbstractFileByPath(unencoded);
			if (!(file instanceof TFile)) {
				this.logger.error("[  PROCESS IMG  ]   could not find file: ", unencoded);	
				return;
			}

			try {
				// Process image and get cache path
				const buffer = await this.app.vault.readBinary(file);
				const cachePath = await this.processImage(file, buffer, filters);

				// update img element
				img.src = this.app.vault.getResourcePath({ path: cachePath } as TFile);

				this.logger.log("[  PROCESS IMG  ]   old src: ", src);
				this.logger.log("[  PROCESS IMG  ]   new src: ", img.src);

			} catch (error) {
				this.logger.error('[  PROCESS IMG  ]   error:', error);
			}
		}
		else {

			const info: RemoteImageInfo = {
				// use the whole url, so we don't have collisions between websites.
				path: url.toString(),
				basename: path.basename(url.pathname).replace(/\..*$/, ''),
				name: path.basename(url.pathname),
				// don't assume any modification times about remote files.
				stat: { mtime: Number.MAX_VALUE }
			};

			const response = await requestUrl(url.toString());
			const buffer = response.arrayBuffer;
			const cachePath = await this.processImage(info, buffer, filters);

			// update img element
			img.src = this.app.vault.getResourcePath({ path: cachePath } as TFile);

			this.logger.log("[  PROCESS IMG  ]   old src: ", src);
			this.logger.log("[  PROCESS IMG  ]   new src: ", img.src);

		}
	}

	private async processImage(file: ImageInfo, data: ArrayBuffer, filters: Array<ImageFilter>): Promise<string> {
		const filterNames = filters.map(f => f.getName());
		const cachePath = this.cache.cachePath(file, filterNames);

		if (this.cache.isFresh(file, filterNames)) {
			this.logger.log("[  PROCESS IMG  ]   cache hit: ", cachePath);
			return cachePath;
		}

		try {
			// Read image from the vault
			const image = await Image.load(data);

			// Apply filters
			const output = filters.reduce(
				(input, filter) => filter.processImage(input),
				{ data: image, file: file } as FilterInputOutput
			);

			// Save image
			const pngBuffer = await output.data.toBuffer({ format: 'png' });
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
		if (this.observer) {
			this.observer.disconnect();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
			.setName('Cache Directory')
			.setDesc('Where the modified images will be stored')
			.addText(text => text
				.setPlaceholder('Enter the path relative to the vault')
				.setValue(this.plugin.settings.cacheDir)
				.onChange(async (value) => {
					this.plugin.settings.cacheDir = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Clear cache")
			.setDesc("Clear the image cache")
			.addButton((button) => {
				button.onClick(() => this.plugin.clearCache())
				button.setButtonText("Clear cache")
			});
		
		new Setting(containerEl)
			.setName("Debug mode")
			.setDesc("Enable debug mode. This turn on things like logging.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.debug);
				toggle.onChange(async val => {
					this.plugin.settings.debug = val;
					await this.plugin.saveSettings();
				});
			});
	}
}