export function combineLoHi(hi: number, lo: number)
{
    let hi_big = BigInt(hi);
    let lo_big = BigInt(lo);
    if (hi_big < 0)
        hi_big += 1n << 32n;
    let result = (hi_big << 32n) | (lo_big & 0xFFFFFFFFn);

    if (result >= (1n << 63n))
        result -= 1n << 64n;

    // Let's hope the timestamp won't exceed 2^53 - 1...
    return Number(result);
}
