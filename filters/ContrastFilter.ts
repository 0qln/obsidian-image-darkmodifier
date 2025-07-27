import { ImageFilter } from 'filters/ImageFilter';
import { FilterInputOutput } from 'filters/FilterInputOutput';
import { FilterInput } from 'filters/FilterInput';

export type ContrastAmountParam = number;
export const ContrastAmountParamName = "amount";

export const ContrastFilterName = "contrast";
export class ContrastFilter implements ImageFilter {
	private amount: number = 1;

	constructor(amount: ContrastAmountParam | undefined = undefined) {
		this.amount = amount ?? this.amount;
	}

	getName(): string {
		return `${ContrastFilterName}(${ContrastAmountParamName}=${this.amount})`;
	}

	processImage(image: FilterInput): FilterInputOutput {
        const c = this.amount;
        const data = image.data.data;
		for (let i = 0; i < data.length; i += image.data.bitDepth) {
			const r = data[i + 0] / 255;
			const g = data[i + 1] / 255;
			const b = data[i + 2] / 255;
            
            data[i + 0] = (r + ((1 - r) * c * r)) * 255;
            data[i + 1] = (g + ((1 - g) * c * g)) * 255;
            data[i + 2] = (b + ((1 - b) * c * b)) * 255;
		}

		return {
			data: image.data,
			file: image.file
		};
	}
}