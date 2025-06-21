import { App, FileSystemAdapter, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import * as path from 'path';
import * as fs from 'fs';
import { Image } from 'image-js';
import * as crypto from 'crypto';
import { assert } from 'console';

interface ImageDarkmodifierPluginSettings {
	cacheDir: string;
	imgSelector: string;
}

const DEFAULT_SETTINGS: ImageDarkmodifierPluginSettings = {
	cacheDir: path.join('.obsidian', '.dark-image-cache'),
	imgSelector: 'img[alt*="@"]',
}

class ImageCache {
	private cacheDir: string;
	private vaultPath: string;

	constructor(vaultPath: string, cacheDir: string) {
		this.cacheDir = cacheDir;
		this.vaultPath = vaultPath;
		this.ensureCacheDir();
	}
	
	absoluteCacheDir(): string {
		return path.join(this.vaultPath, this.cacheDir);
	}

	private ensureCacheDir() {
		const dir = this.absoluteCacheDir();
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
	}

	setCacheDir(newPath: string) {
		this.cacheDir = newPath;
		this.ensureCacheDir();
	}

	private getSafeHash(filePath: string, length = 12): string {
		return crypto
			.createHash('sha256')
			.update(filePath)
			.digest('hex')
			.substring(0, length);
	}

	cacheName(file: TFile, filterNames: Array<string>): string {
		const hash = this.getSafeHash(file.path);
		const name = file.basename.replace(/[^a-zA-Z0-9_-]/g, '_');
		return `${name}_${hash}_${filterNames.join('_')}.png`;
	}

	cachePath(file: TFile, filternames: Array<string>): string {
		return path.join(this.cacheDir, this.cacheName(file, filternames));
	}
	
	absoluteCachePath(file: TFile, filternames: Array<string>): string {
		return path.join(this.vaultPath, this.cachePath(file, filternames));
	}

	isFresh(file: TFile, filterNames: string[]): boolean {
		const cachePath = this.absoluteCachePath(file, filterNames);
		try {
			if (!fs.existsSync(cachePath)) return false;

			const cacheStat = fs.statSync(cachePath);
			return cacheStat.mtimeMs >= file.stat.mtime;
		} catch {
			return false;
		}
	}

	clear(file: TFile, filterNames: string[]) {
		const cachePath = this.absoluteCachePath(file, filterNames);

		console.log('[  CACHE  ]   clear: ', cachePath);

		try {
			if (fs.existsSync(cachePath)) {
				fs.unlinkSync(cachePath);
			}
		} catch (error) {
			console.error('[  CACHE  ]   failed to clear cache:', error);
		}
	}

	clearAllForFile(file: TFile) {
		console.log('[  CACHE  ]   clear all: ', file.name);

		try {
			const cacheDir = this.absoluteCacheDir();
			const files = fs.readdirSync(cacheDir);
			const fileHash = this.getSafeHash(file.path);

			files.forEach(filename => {
				if (filename.includes(fileHash)) {
					const filePath = path.join(cacheDir, filename);
					fs.unlinkSync(filePath);

					console.log('[  CACHE  ]   * clear: ', filePath);
				}
			});
		} catch (error) {
			console.error('[  CACHE  ]   failed to clear cache for file:', error);
		}
	}

	clearEntireCache() {
		const cacheDir = this.absoluteCacheDir();

		console.log('[  CACHE  ]   clear entire cache: ', cacheDir);

		try {
			const files = fs.readdirSync(cacheDir);
			files.forEach(filename => {
				const filePath = path.join(cacheDir, filename);
				if (fs.existsSync(filePath)) {
					fs.unlinkSync(filePath);

					console.log('[  CACHE  ]   * clear: ', filePath);
				}
			});
		} catch (error) {
			console.error('[  CACHE  ]   failed to clear cache:', error);
		}
	}
}

interface ImageInput {
	data: Image,
	file: TFile,
}

interface ImageOutput {
	data: Image,
}

class ImageInputOutput implements ImageInput, ImageOutput {
	// the current data
	data: Image;

	// the original file
	file: TFile;
}

class ImageFilterResult {
	pathResult: Promise<string>
}

interface ImageFilter {
	getName(): string;

	processImage(image: ImageInput): ImageOutput;
}

const DarkFilterName = "dark";
class DarkFilter implements ImageFilter {
	getName(): string {
		return DarkFilterName;
	}

	processImage(image: ImageInput): ImageInputOutput {

		// Invert colours
		const inverted = image.data.invert();

		return {
			data: inverted,
			file: image.file,
		};
	}
}

const TransparentFilterName = "transparent";
class TransparentFilter implements ImageFilter {
	private threshold: number = 13;

	constructor(threshold: number) {
		this.threshold = threshold;
	}

	getName(): string {
		return `${TransparentFilterName}--threshold=${this.threshold}`;
	}

	processImage(image: ImageInput): ImageInputOutput {
		// Ensure we are in 8‑bit RGBA space (adds alpha if missing)
		if (image.data.alpha === 0) {
			image.data = image.data.rgba8();
		}

		const data = image.data.data;
		for (let i = 0; i < data.length; i += 4) {
			const r = data[i];
			const g = data[i + 1];
			const b = data[i + 2];

			// Make Near‑black fully transparent
			if (r < this.threshold &&
				g < this.threshold &&
				b < this.threshold
			) {
				data[i] = data[i + 1] = data[i + 2] = 0;
				data[i + 3] = 0;
			}
		}

		return {
			data: image.data,
			file: image.file
		};
	}
}

const BoostLightnessFilterName = "boost-lightness";
class BoostLightnessFilter implements ImageFilter {
	boost: number = 1.2;

	constructor(boost: number) {
		this.boost = boost;
	}

	getName(): string {
		return `${BoostLightnessFilterName}--boost=${this.boost}`;
	}

	processImage(image: ImageInput): ImageInputOutput {
		const data = image.data.data;
		const step = image.data.channels;

		assert(image.data.colorModel.startsWith("RGB"));

		for (let i = 0; i < data.length; i += step) {
			const r = data[i];
			const g = data[i + 1];
			const b = data[i + 2];

			// Boost lightness in HSL space
			const [h, s, l] = this.rgbToHsl(r, g, b); // l \in [0,100]
			const [nr, ng, nb] = this.hslToRgb(h, s, Math.min(100, l * this.boost));

			data[i] = nr;
			data[i + 1] = ng;
			data[i + 2] = nb;
		}

		return {
			data: image.data,
			file: image.file
		};
	}

	// Helper: Convert RGB (0-255) to HSL (0-360, 0-100, 0-100)
	private rgbToHsl(r: number, g: number, b: number): [number, number, number] {
		r /= 255; g /= 255; b /= 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		let h = 0, s = 0;
		const l = (max + min) / 2 * 100;

		if (max !== min) {
			const d = max - min;
			s = l > 50 ? d / (2 - max - min) : d / (max + min);
			s *= 100;

			switch (max) {
				case r: h = (g - b) / d + (g < b ? 6 : 0); break;
				case g: h = (b - r) / d + 2; break;
				case b: h = (r - g) / d + 4; break;
			}
			h = (h * 60) % 360;
		}
		return [h < 0 ? h + 360 : h, s, l];
	}

	// Helper: Convert HSL to RGB (0-255)
	private hslToRgb(h: number, s: number, l: number): [number, number, number] {
		h /= 360; s /= 100; l /= 100;
		let r, g, b;

		if (s === 0) {
			r = g = b = l;
		} else {
			const hue2rgb = (p: number, q: number, t: number) => {
				if (t < 0) t += 1;
				if (t > 1) t -= 1;
				if (t < 1 / 6) return p + (q - p) * 6 * t;
				if (t < 1 / 2) return q;
				if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
				return p;
			};

			const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
			const p = 2 * l - q;
			r = hue2rgb(p, q, h + 1 / 3);
			g = hue2rgb(p, q, h);
			b = hue2rgb(p, q, h - 1 / 3);
		}

		return [
			Math.round(r * 255),
			Math.round(g * 255),
			Math.round(b * 255)
		];
	}
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
			this.app.vault.on('modify', file => {
				this.processAllImgs();
			})
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

		const filters: Array<ImageFilter> = alt.match(/@[-=.\w]+/gm)?.map(filter => {
			const name = filter.match(/(?<=@)([\w]|-\w)+/)?.[0];
			if (!name) return false;

			// options may look like the following:
			// --option-name
			// --option-name=string_value
			// --option-name=42
			// --option-name=4.2
			// --option-name=-69
			// --option-name=-6.9
			const options = new Map<string, any>(
				filter.match(/(?<=--)\w+((=-{0,1}[_.\w\d]+)){0,1}/g)
					?.map(option => {
						// get key
						const key = option.match(/^[-_\w]+/)?.[0];
						if (!key) return ["<invalid>", undefined];

						// get value
						const intValue = option.match(/(?<==)-{0,1}\d+$/)?.[0];
						const floatValue = option.match(/(?<==)-{0,1}\d*\.\d*$/)?.[0];
						const stringValue = option.match(/(?<==)[_a-zA-Z]+/)?.[0];
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
				case DarkFilterName: return new DarkFilter();
				case TransparentFilterName: return new TransparentFilter(options.get("threshold") as number);
				case BoostLightnessFilterName: return new BoostLightnessFilter(options.get("boost") as number);
				default: return false;
			}
		}).filter(x => x != false) ?? [];

		console.log("[  PROCESS IMG  ]   parsed filters: ", filters);

		if (!filters.length) return;

		// e.g. "app://0416c8ca637323b6aba7936c0ca89359b6a0/E:/obsidian-modules/test-vault/test-vault/1_oTtENBrl4x7EZlLYQo0GQA.webp?1750355750710"
		const src = img.src;
		const vaultPath = this.getVaultPath() || '';
		const escapedVaultPath = vaultPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\\/g, '/');
		const regex = new RegExp(`(?<=${escapedVaultPath}?/).*(?=[?].*)`);
		const srcVaultPath = src.match(regex)?.[0];

		if (!srcVaultPath) return;

		// Get the actual file
		const file = this.app.vault.getAbstractFileByPath(srcVaultPath);
		if (!(file instanceof TFile)) return;

		try {
			// Process image and get cache path
			const cachePath = await this.processImage(file, filters);

			// update img element
			console.log("[  PROCESS IMG  ]   old src: ", file.path);
			console.log("[  PROCESS IMG  ]   new src: ", cachePath);

			img.src = img.src.replace(file.path, cachePath);

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
				{ data: image, file: file } as ImageInput
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

// todo: handle internet images