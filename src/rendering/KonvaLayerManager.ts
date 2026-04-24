import Konva from "konva";
import type {Camera} from "../Camera";
import type {Settings} from "../types/Settings";
import type {StageInfo} from "../CullingManager";
import {KonvaLayerNode} from "../backend/KonvaBackend";
import {RecordingLayerNode} from "../backend/CanvasBackend";

/**
 * Owns the Konva Stage and its layers. All rendering logic lives in MapRenderer;
 * this class handles only the physical canvas infrastructure.
 */
export class KonvaLayerManager {
    readonly stage: Konva.Stage;
    readonly gridLayer: Konva.Layer;
    readonly overlayLayer: Konva.Layer;
    readonly positionLayer: Konva.Layer;
    readonly topLabelLayer: Konva.Layer;

    /** Single Konva.Layer shared by link exits and rooms; z-order by insertion. */
    private readonly sceneLayer: Konva.Layer;

    readonly sceneNode: RecordingLayerNode;
    readonly gridLayerNode: RecordingLayerNode;
    readonly topLabelLayerNode: RecordingLayerNode;
    readonly overlayLayerNode: KonvaLayerNode;
    readonly positionLayerNode: KonvaLayerNode;

    private origCameraSetSize?: (w: number, h: number) => void;

    constructor(container: HTMLDivElement | undefined, settings: Settings, camera: Camera) {
        if (container) {
            this.stage = new Konva.Stage({
                container,
                width: container.clientWidth,
                height: container.clientHeight,
                draggable: false,
            });
            container.style.backgroundColor = settings.backgroundColor;
        } else {
            this.stage = new Konva.Stage({ width: 1, height: 1 });
        }

        this.gridLayer = new Konva.Layer({ listening: false });
        this.stage.add(this.gridLayer);

        this.sceneLayer = new Konva.Layer({ listening: false });
        this.stage.add(this.sceneLayer);

        this.positionLayer = new Konva.Layer({ listening: false });
        this.stage.add(this.positionLayer);

        this.overlayLayer = new Konva.Layer({ listening: false });
        this.stage.add(this.overlayLayer);

        this.topLabelLayer = new Konva.Layer({ listening: false });
        this.stage.add(this.topLabelLayer);

        this.sceneNode = new RecordingLayerNode(this.sceneLayer);
        this.gridLayerNode = new RecordingLayerNode(this.gridLayer);
        this.topLabelLayerNode = new RecordingLayerNode(this.topLabelLayer);
        this.overlayLayerNode = new KonvaLayerNode(this.overlayLayer);
        this.positionLayerNode = new KonvaLayerNode(this.positionLayer);

        if (container) {
            this.origCameraSetSize = camera.setSize.bind(camera);
            const origSetSize = this.origCameraSetSize;
            camera.setSize = (w: number, h: number) => {
                origSetSize(w, h);
                this.stage.width(w);
                this.stage.height(h);
            };
        }
    }

    getStageInfo(): StageInfo {
        return this.stage;
    }

    applyCamera(camera: Camera): void {
        const scale = camera.getScale();
        this.stage.scale({ x: scale, y: scale });
        this.stage.position(camera.position);
        this.stage.batchDraw();
    }

    restoreCameraSetSize(camera: Camera): void {
        if (this.origCameraSetSize) {
            camera.setSize = this.origCameraSetSize;
        }
    }

    destroy(): void {
        this.stage.destroy();
    }
}
