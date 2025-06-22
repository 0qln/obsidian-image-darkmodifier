import { ImageFilter } from 'filters/ImageFilter';
import { FilterInputOutput } from 'filters/FilterInputOutput';
import { FilterInput } from 'filters/FilterInput';
import Color, { ColorInstance } from 'color';

export const TransparentFilterName = "transparent";

export type ThresholdParamRemove = 'above' | 'below';
export const ThresholdParamRemoveName = 'remove';

export type ThresholdParamColor = number | ColorInstance; 
export const ThresholdParamColorName = 'threshold';

export class TransparentFilter implements ImageFilter {
	private threshold: ThresholdParamColor = 13;
	private removeDirection: ThresholdParamRemove = 'below';

	constructor(
		threshold: ThresholdParamColor | undefined = undefined,
		removeDirection: ThresholdParamRemove | undefined = undefined
	) {
		this.threshold = threshold ?? this.threshold;
		this.removeDirection = removeDirection ?? this.removeDirection;
	}

	getName(): string {
		return `${TransparentFilterName}(${ThresholdParamColorName}=${this.threshold},${ThresholdParamRemoveName}=${this.removeDirection})`;
	}

	processImage(image: FilterInput): FilterInputOutput {
		// Ensure we are in 8‑bit RGBA space (adds alpha if missing)
		if (image.data.alpha === 0) {
			image.data = image.data.rgba8();
		}

		const threshold = {
			r: this.threshold instanceof Color ? this.threshold.red() : this.threshold,
			g: this.threshold instanceof Color ? this.threshold.green() : this.threshold,
			b: this.threshold instanceof Color ? this.threshold.blue() : this.threshold
		}

		const data = image.data.data;
		for (let i = 0; i < data.length; i += 4) {
			const r = data[i];
			const g = data[i + 1];
			const b = data[i + 2];

			// Make Near‑black fully transparent
			if (this.removeDirection == 'below') {
				if (r < threshold.r &&
					g < threshold.g &&
					b < threshold.b) {
					data[i] = data[i + 1] = data[i + 2] = 0;
					data[i + 3] = 0;
				}
			}
			else {
				if (r > threshold.r &&
					g > threshold.g &&
					b > threshold.b) {
					data[i] = data[i + 1] = data[i + 2] = 0;
					data[i + 3] = 0;
				}
			}
		}

		return {
			data: image.data,
			file: image.file
		};
	}
}
