import { ImageFilter } from 'filters/ImageFilter';
import { FilterInputOutput } from 'filters/FilterInputOutput';
import { FilterInput } from 'filters/FilterInput';

export const BoostLightnessFilterName = "boost-lightness";
export class BoostLightnessFilter implements ImageFilter {
	amount: number = 1.2;

	constructor(amount: number) {
		this.amount = amount;
	}

	getName(): string {
		return `${BoostLightnessFilterName}(amount=${this.amount})`;
	}

	processImage(image: FilterInput): FilterInputOutput {
		const data = image.data.data;
		const step = image.data.channels;

		console.assert(image.data.colorModel.startsWith("RGB"), "I expected this to some rgb format (ﾒ﹏ﾒ)");

		for (let i = 0; i < data.length; i += step) {
			const r = data[i];
			const g = data[i + 1];
			const b = data[i + 2];

			// Boost lightness in HSL space
			const [h, s, l] = this.rgbToHsl(r, g, b); // l \in [0,100]
			const [nr, ng, nb] = this.hslToRgb(h, s, Math.min(100, l * this.amount));

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
