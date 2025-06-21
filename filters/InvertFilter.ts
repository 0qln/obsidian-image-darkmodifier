import { ImageFilter } from 'filters/ImageFilter';
import { FilterInputOutput } from 'filters/FilterInputOutput';
import { FilterInput } from 'filters/FilterInput';

export const InvertFilterName = "invert";
export class InvertFilter implements ImageFilter {
	getName(): string {
		return InvertFilterName;
	}

	processImage(image: FilterInput): FilterInputOutput {
		const inverted = image.data.invert();
		return {
			data: inverted,
			file: image.file,
		};
	}
}
