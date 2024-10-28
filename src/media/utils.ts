import LibAV from "@libav.js/variant-webcodecs";

export function combineLoHi(hi: number, lo: number): number
{
    return LibAV.i64tof64(lo, hi);
}
