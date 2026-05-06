/**
 * delays.ts
 *
 * Timing utilities that simulate human interaction cadence.
 */

/**
 * Waits for a random duration to simulate human interaction cadence without
 * making ordinary form entry feel artificially slow.
 */
export function humanDelay(minMs = 80, maxMs = 180): Promise<void> {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function navigationDelay(): Promise<void> {
    return humanDelay(140, 320);
}
