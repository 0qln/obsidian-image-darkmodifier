import { FilterInput } from 'filters/FilterInput';
import { FilterOutput } from 'filters/FilterOutput';

export interface ImageFilter {
	getName(): string;

	processImage(image: FilterInput): FilterOutput;
}
