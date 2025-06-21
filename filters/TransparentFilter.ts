import { ImageFilter } from 'filters/ImageFilter';
import { FilterInputOutput } from 'filters/FilterInputOutput';
import { FilterInput } from 'filters/FilterInput';

export const TransparentFilterName = "transparent";
export class TransparentFilter implements ImageFilter {
	private threshold: number = 13;

	constructor(threshold: number) {
		this.threshold = threshold;
	}

	getName(): string {
		return `${TransparentFilterName}(threshold=${this.threshold})`;
	}

	processImage(image: FilterInput): FilterInputOutput {
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
				b < this.threshold) {
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
