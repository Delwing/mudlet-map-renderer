import { describe, it, expect } from 'vitest';
import { MapState } from '../src/MapState';
import { computeHighlight } from '../src/scene/OverlayStyle';
import { createSettings } from '../src/types/Settings';
import { createTestMapReader } from './helpers';

// 2.1.0 kept the highlight API backward compatible while adding multi-colour
// support and the `shape` selector. These lock in the deprecated-but-present
// fields and the optional `shape` behaviour.

describe('highlight backward compatibility', () => {
    it('HighlightEntry keeps the deprecated `color` field equal to colors[0]', () => {
        const st = new MapState(createTestMapReader(), createSettings());
        st.addHighlight(1, ['#ff0000', '#00ff00']);
        const entry = st.highlights.get(1)!;
        expect(entry.colors).toEqual(['#ff0000', '#00ff00']);
        expect(entry.color).toBe('#ff0000');
    });

    it("the 'highlight' event still carries `color` alongside `colors`", () => {
        const st = new MapState(createTestMapReader(), createSettings());
        const events: Array<{ color: string | undefined; colors: string[] | undefined }> = [];
        st.events.on('highlight', (e) => events.push(e));

        st.addHighlight(1, '#abcdef');
        expect(events.at(-1)).toMatchObject({ color: '#abcdef', colors: ['#abcdef'] });

        st.removeHighlight(1);
        expect(events.at(-1)).toMatchObject({ color: undefined, colors: undefined });
    });

    it('shape defaults to match-room-shape behaviour when shape is omitted', () => {
        const s = createSettings();
        delete s.highlight.shape;            // pre-2.1.0 settings have no `shape`
        delete s.highlight.matchRoomShape;   // ...and may lack matchRoomShape too

        const room = { x: 0, y: 0 } as MapData.Room;
        s.roomShape = 'rectangle';
        expect(computeHighlight(room, '#f00', s).shape).toBe('rect'); // defaults to following the room

        s.roomShape = 'circle';
        expect(computeHighlight(room, '#f00', s).shape).toBe('circle');
    });
});
