import { FilterInput } from 'filters/FilterInput';
import { FilterOutput } from 'filters/FilterOutput';
import Image from 'image-js';
import { ImageInfo } from 'ImageCache';


export class FilterInputOutput implements FilterInput, FilterOutput {
	// the current data
	data: Image;

	// the original file
	file: ImageInfo;
}
