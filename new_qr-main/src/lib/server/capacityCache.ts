// In-memory cache for ultra-fast Security Capacity responses without duplicate queries
interface CachedCapacity {
    campuses: any[];
    timestamp: number;
}

let cachedCapacity: CachedCapacity | null = null;

export function getCachedCapacity(): any[] | null {
    if (cachedCapacity && (Date.now() - cachedCapacity.timestamp < 5000)) {
        return cachedCapacity.campuses;
    }
    return null;
}

export function setCachedCapacity(campuses: any[]) {
    cachedCapacity = { campuses, timestamp: Date.now() };
}

export function invalidateCapacityServerCache() {
    cachedCapacity = null;
}
