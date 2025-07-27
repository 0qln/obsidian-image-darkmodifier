import { FilterInput } from "./FilterInput";
import { FilterOutput } from "./FilterOutput";
import { ImageFilter } from "./ImageFilter";

export class WhiteBalanceFilter implements ImageFilter {
    getName(): string {
        throw new Error("Method not implemented.");
    }
    processImage(image: FilterInput): FilterOutput {
        const reds: Array<number> = [];
        const greens = [];
        const blues = [];

        let maxPoints = [ -1, -1 ];
        const data = image.data.data;
		for (let i = 0; i < data.length; i += image.data.bitDepth) {
			const r = data[i + 0] / 255;
			const g = data[i + 1] / 255;
			const b = data[i + 2] / 255;
            if (r > 200 && g > 200 && b > 200) {
                reds.push(r);
                blues.push(b);
                greens.push(g);
                const sum = r + g + b;
                if (sum > maxPoints[1]) {
                    maxPoints = [i, sum];
                }
            }
        }
        
        var redsAvg = reds.reduce((x, y) => x + y, 0) / reds.length;
        var greensAvg = greens.reduce((x, y) => x + y, 0) / greens.length;
        var bluesAvg = blues.reduce((x, y) => x + y, 0) / blues.length;
        
        if (redsAvg > greensAvg && redsAvg > bluesAvg) {
            // add green & blue to achieve white
            
        }
    }

}