import { BoostLightnessFilter } from "./BoostLightnessFilter";
import { FilterInput } from "./FilterInput";
import { FilterInputOutput } from "./FilterInputOutput";
import { FilterOutput } from "./FilterOutput";
import { ImageFilter } from "./ImageFilter";
import { InvertFilter } from "./InvertFilter";
import { TransparentFilter } from "./TransparentFilter";


export const DarkModeFilterName = "darkmode";

export class DarkModeFilter implements ImageFilter {
    private invertFilter: InvertFilter = new InvertFilter();
    private transparentFilter: TransparentFilter = new TransparentFilter();
    private boostLightnessFilter: BoostLightnessFilter = new BoostLightnessFilter();

    getName(): string {
        return DarkModeFilterName;
    }
    
    processImage(image: FilterInput): FilterOutput {
        let x: FilterInputOutput = image;
        x = this.invertFilter.processImage(x);
        x = this.transparentFilter.processImage(x);
        x = this.boostLightnessFilter.processImage(x);
        return x;
    }
}