import { BoostLightnessFilter } from "./BoostLightnessFilter";
import { FilterInput } from "./FilterInput";
import { FilterInputOutput } from "./FilterInputOutput";
import { FilterOutput } from "./FilterOutput";
import { ImageFilter } from "./ImageFilter";
import { InvertFilter } from "./InvertFilter";
import { TransparentFilter } from "./TransparentFilter";
import Color from 'color';


export const DarkModeFilterName = "darkmode";

export class DarkModeFilter implements ImageFilter {
    private invertFilter: InvertFilter = new InvertFilter();
    private transparentFilterDark: TransparentFilter = new TransparentFilter();
    private transparentFilterLight: TransparentFilter;
    private boostLightnessFilterDark: BoostLightnessFilter = new BoostLightnessFilter();
    private boostLightnessFilterLight: BoostLightnessFilter;

    constructor() {
        // For light mode: remove bright backgrounds (above threshold ~240)
        this.transparentFilterLight = new TransparentFilter(
            Color('rgb(240, 240, 240)'),
            "above"
        );
        // For light mode: reduce lightness to increase contrast
        this.boostLightnessFilterLight = new BoostLightnessFilter(0.85);
    }

    getName(): string {
        return DarkModeFilterName;
    }
    
    processImage(image: FilterInput, theme?: 'light' | 'dark'): FilterOutput {
        let x: FilterInputOutput = image;
        
        // If theme is 'light', apply light mode adjustments
        if (theme === 'light') {
            // No inversion - keep original colors
            // Remove bright backgrounds
            x = this.transparentFilterLight.processImage(x);
            // Darken slightly for better contrast
            x = this.boostLightnessFilterLight.processImage(x);
        } else {
            // Default behavior (dark mode or no theme specified) - backward compatible
            x = this.invertFilter.processImage(x);
            x = this.transparentFilterDark.processImage(x);
            x = this.boostLightnessFilterDark.processImage(x);
        }
        
        return x;
    }
}