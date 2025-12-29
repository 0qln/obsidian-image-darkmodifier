import { FilterInput } from 'filters/FilterInput';
import { FilterOutput } from 'filters/FilterOutput';

export interface ImageFilter {
	getName(): string;

	processImage(image: FilterInput, theme?: 'light' | 'dark'): FilterOutput;
}
