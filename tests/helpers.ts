import MapReader from '../src/reader/MapReader';
import testMap from './fixtures/test-map.json';
import testEnvs from './fixtures/test-envs.json';

export function createTestMapReader(): MapReader {
    // Deep clone because MapReader mutates room.y in place
    const map = JSON.parse(JSON.stringify(testMap)) as MapData.Map;
    const envs = JSON.parse(JSON.stringify(testEnvs)) as MapData.Env[];
    return new MapReader(map, envs);
}
