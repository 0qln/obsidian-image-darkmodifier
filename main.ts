import { App, FileSystemAdapter, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import * as path from 'path';
import { Image } from 'image-js';
import { ImageCache } from 'ImageCache';
import { ImageFilter } from 'filters/ImageFilter';
import { InvertFilterName, InvertFilter } from 'filters/InvertFilter';
import { TransparentFilterName, TransparentFilter } from 'filters/TransparentFilter';
import { BoostLightnessFilterName, BoostLightnessFilter } from 'filters/BoostLightnessFilter';
import { FilterInput } from 'filters/FilterInput';

interface ImageDarkmodifierPluginSettings {
	cacheDir: string;
	imgSelector: string;
}

const DEFAULT_SETTINGS: ImageDarkmodifierPluginSettings = {
	cacheDir: path.join('.obsidian', '.dark-image-cache'),
	imgSelector: 'img',
}

export default class ImageDarkmodifierPlugin extends Plugin {
	settings: ImageDarkmodifierPluginSettings;
	private observer: MutationObserver;
	private cache: ImageCache;

	getVaultPath(): string | null {
		let adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return null;
	}

	async onload() {
		await this.loadSettings();

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

		this.cache = new ImageCache(this.getVaultPath() || '', this.settings.cacheDir);

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
		console.log("[  PROCESS IMG  ]   process img: ", img)

		const alt = img.alt;
		const src = img.src;
		const originalSrc = img.getAttr('original-src') || src;
		img.setAttr('original-src', originalSrc);

		// todo: suppoert for internet sources 

		const filters: Array<ImageFilter> = alt.match(/@[-\w]+(\(.+?\))?/gm)?.map(filter => {
			const name = filter.match(/(?<=@)[-\w]+/)?.[0];
			if (!name) return false;

			// options may look like the following:
			// option-name
			// option-name=string_value-
			// option-name=42
			// option-name=4.2
			// option-name=-69
			// option-name=-6.9
			const options = new Map<string, any>(
				filter.match(/(?<=\(\s*|,\s*)[-\w]+(\s*=\s*[-_.\w\d]+)?/g)
					?.map(option => {
						// get key
						const key = option.match(/^[-_\w]+/)?.[0];
						if (!key) return ["<invalid>", undefined];

						// get value
						const intValue = option.match(/(?<=\s*=\s*)-?\d+$/)?.[0];
						const floatValue = option.match(/(?<=\s*=\s*)-?\d*\.\d*$/)?.[0];
						const stringValue = option.match(/(?<=\s*=\s*)[-_a-zA-Z]+$/)?.[0];
						const value =
							intValue ? Number.parseInt(intValue)
								: floatValue ? Number.parseFloat(floatValue)
									: stringValue ? stringValue
										: true;

						return [key, value];
					})
				?? []
			);

			switch (name) {
				case InvertFilterName: return new InvertFilter();
				case TransparentFilterName: return new TransparentFilter(options.get("threshold") as number);
				case BoostLightnessFilterName: return new BoostLightnessFilter(options.get("amount") as number);
				default: return false;
			}
		}).filter(x => x != false) ?? [];

		console.log("[  PROCESS IMG  ]   parsed filters: ", filters);
		
		// Reset to the old src 
		if (!filters.length) {
			img.src = originalSrc;
			console.log("[  PROCESS IMG  ]   resetting src. ");
			return;
		}

		const vaultPath = this.getVaultPath() || '';
		const escapedVaultPath = vaultPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\\/g, '/');
		const regex = new RegExp(`(?<=${escapedVaultPath}?/).*(?=[?].*)`);
		const originalSrcVaultPath = originalSrc.match(regex)?.[0];

		if (!originalSrcVaultPath) return;

		// Get the actual file
		const file = this.app.vault.getAbstractFileByPath(originalSrcVaultPath);
		if (!(file instanceof TFile)) return;

		try {
			// Process image and get cache path
			const cachePath = await this.processImage(file, filters);

			// update img element
			img.src = originalSrc.replace(file.path, cachePath);

			console.log("[  PROCESS IMG  ]   old src: ", src);
			console.log("[  PROCESS IMG  ]   new src: ", img.src);

		} catch (error) {
			console.error('Dark Image Processing Error:', error);
		}
	}

	private async processImage(file: TFile, filters: Array<ImageFilter>): Promise<string> {
		const filterNames = filters.map(f => f.getName());
		const cachePath = this.cache.cachePath(file, filterNames);

		if (this.cache.isFresh(file, filterNames)) {
			console.log("[  PROCESS IMG  ]   cache hit: ", cachePath);
			return cachePath;
		}

		try {
			// Read image from the vault
			const buffer = await this.app.vault.readBinary(file);
			const image = await Image.load(buffer);

			// Apply filters
			const output = filters.reduce(
				(input, filter) => filter.processImage(input),
				{ data: image, file: file } as FilterInput
			);

			// Save image
			const pngBuffer = await output.data.toBuffer({ format: 'png' });
			await this.app.vault.adapter.writeBinary(cachePath, pngBuffer);

			console.log("[  PROCESS IMG  ]   cache miss: ", cachePath);
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
				.setPlaceholder('Enter the path')
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

		// todo: option to detect, whether an image should get the filter automatically and then also add a @dark in the alt after the user pasted the image, as if the user did it.
	}
}