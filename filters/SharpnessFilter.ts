import { ImageFilter } from 'filters/ImageFilter';
import { FilterInput } from './FilterInput';
import { FilterOutput } from './FilterOutput';

// todo: we can add a paramater for the kernel radius.

export type SharpnessAmountParam = number;
export const SharpnessAmountParamName = "amount";

export const SharpnessFilterName = "sharpness";
export class SharpnessFilter implements ImageFilter {
	private amount: number = 1.0;

	constructor(amount: SharpnessAmountParam | undefined = undefined) {
		this.amount = amount ?? this.amount;
	}
    processImage(image: FilterInput): FilterOutput {
		const a = this.amount;
		const nWeights = 8;
		const c = 1 + nWeights * a;
        const x = a;
		const kernel = [
			[ -x, -x, -x ],
			[ -x, +c, -x ],
			[ -x, -x, -x ],
		];
		image.data = image.data.convolution(kernel, { normalize: false });

		return {
			data: image.data,
		};

    }

	getName(): string {
		return `${SharpnessFilterName}(${SharpnessAmountParamName}=${this.amount})`;
	}
}
