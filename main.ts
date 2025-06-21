import { App, Editor, FileSystemAdapter, MarkdownPostProcessorContext, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import * as path from 'path';
import * as fs from 'fs';
import { Image } from 'image-js';

interface ImageDarkmodifierPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: ImageDarkmodifierPluginSettings = {
	mySetting: 'default'
}

export default class ImageDarkmodifierPlugin extends Plugin {
	settings: ImageDarkmodifierPluginSettings;
	private cacheDir: string;
	private vaultPath: string;
	private observer: MutationObserver;
	private processedElements: WeakSet<HTMLElement> = new WeakSet();

	getVaultPath(): string | null {
		let adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return null;
	}

	async onload() {
		await this.loadSettings();

		this.vaultPath = this.getVaultPath() || '';
		this.cacheDir = path.join(".obsidian", '.dark-image-cache');

		console.log('onload')

		this.processAllEmbeds();

		this.observer = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				mutation.addedNodes.forEach((node) => {
					if (node instanceof HTMLElement) {
						this.processNode(node);
					}
				});
			});
		});

		this.observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: false,
			characterData: false
		});

		// Re-process when switching between modes
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.processAllEmbeds();
			})
		);

		// Re-process when files are modified
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile) {
					this.clearCache(file);
					this.processAllEmbeds();
				}
			})
		);
	}
	
	 private processAllEmbeds() {
        const embeds = document.querySelectorAll('.internal-embed.media-embed.image-embed');
        embeds.forEach(embed => {
            if (!this.processedElements.has(embed as HTMLElement)) {
                this.processEmbed(embed as HTMLElement);
            }
        });
    }
	
	private processNode(node: HTMLElement) {
        // Check if node is an image embed
        if (node.matches('.internal-embed.media-embed.image-embed')) {
            this.processEmbed(node);
            return;
        }

        // Check for embeds within the node
        const embeds = node.querySelectorAll('.internal-embed.media-embed.image-embed');
        embeds.forEach(embed => {
            if (!this.processedElements.has(embed as HTMLElement)) {
                this.processEmbed(embed as HTMLElement);
            }
        });
    }
	
	private async processEmbed(embed: HTMLElement) {
        // Skip if already processed
        if (this.processedElements.has(embed)) return;
	
		console.log("process embed: ", embed)
        
		const alt = embed.getAttribute('alt') || '';
		if (!alt.includes('@dark')) return;
	
		console.log(alt)
        
        const src = embed.getAttribute('src');
        if (!src) return;
	
		console.log(src)
        
        const img = embed.querySelector('img');
        if (!img) return;
	
		console.log(img)
        
        // Skip if already processed
        if (img.hasAttribute('data-dark-processed')) return;
        
        // Get the actual file
        const file = this.app.vault.getAbstractFileByPath(src);
        if (!(file instanceof TFile)) return;
		console.log(file);
        
        try {
            // Process image and get cache path
            const cachePath = await this.processImage(file);

			console.log(path.join(this.vaultPath, cachePath));

			// update img element
			// there's sometimes weird query params like "path/file.png?9845729" behind the thingy, so 
			// we need to also replace those.
			img.src = img.src.replace(new RegExp(`${file.path}.*`), cachePath);
            img.classList.add('dark-processed-image');
            img.setAttribute('data-dark-processed', 'true');

			// add embed element as processed
            this.processedElements.add(embed);

        } catch (error) {
            console.error('Dark Image Processing Error:', error);
            embed.classList.add('dark-image-error');
        }
    }
	
    private clearCache(file: TFile) {
        const cacheName = `${file.basename}_dark.png`;
        const cachePath = path.join(this.cacheDir, cacheName);
        if (fs.existsSync(cachePath)) {
            fs.unlinkSync(cachePath);
        }
    }

	private async processImage(file: TFile): Promise<string> {
		const cacheName = `${file.basename}_dark.png`;
		const cachePath = path.join(this.cacheDir, cacheName);

		// Check cache freshness
		if (fs.existsSync(cachePath)) {
			const cacheTime = fs.statSync(cachePath).mtimeMs;
			if (cacheTime > file.stat.mtime) return cachePath;
		}

		try {
			// Read image from the vault
			const buffer = await this.app.vault.readBinary(file);

			// Load the buffer with image‑js
			let image = await Image.load(buffer);

			// Ensure we are in 8‑bit RGBA space (adds alpha if missing)
			if (image.alpha === 0) {
				image = image.rgba8();
			}

			// Invert colours (returns a copy)
			const inverted = image.invert();

			const threshold = 13; // 0.05 * 255 ≈ 13
			const data = inverted.data; // Uint8ClampedArray ordered RGBA per pixel

			// Walk through every pixel
			for (let i = 0; i < data.length; i += 4) {
				const r = data[i];
				const g = data[i + 1];
				const b = data[i + 2];

				// Near‑black → fully transparent
				if (r < threshold && g < threshold && b < threshold) {
					data[i] = data[i + 1] = data[i + 2] = 0;
					data[i + 3] = 0;
					continue;
				}

				// Otherwise boost lightness in HSL space
				const [h, s, l] = this.rgbToHsl(r, g, b); // l ∈ [0,100]
				const [nr, ng, nb] = this.hslToRgb(h, s, Math.min(100, l * 1.2));

				data[i] = nr;
				data[i + 1] = ng;
				data[i + 2] = nb;
				// alpha channel stays unchanged
			}

			// Persist the transformed image
			// await inverted.save(cachePath, { format: 'png', useCanvas: true });
			// return cachePath;

			// 6. Serialise the transformed image to a PNG buffer
			const pngBuffer = await inverted.toBuffer({ format: 'png' });

			// 7. Persist the buffer using Obsidian's file API
			await this.app.vault.adapter.writeBinary(cachePath, pngBuffer);

			return cachePath;

			// const path = await inverted.toDataURL(cachePath, { format: 'png' });
			// console.log(path)
			// return path;

		} catch (error) {
			throw new Error(`Failed to process image: ${error.message}`);
		}
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

class SampleSettingTab extends PluginSettingTab {
	plugin: ImageDarkmodifierPlugin;

	constructor(app: App, plugin: ImageDarkmodifierPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// todo: clear cache button

		// todo: cache directory option

		// todo: option to detect, whether an image should get the filter automatically and then also add a @dark in the alt after the user pasted the image, as if the user did it.

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
