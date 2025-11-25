import Konva from "konva";
import MapReader from "./reader/MapReader";
import {PlanarDirection, planarDirections, oppositeDirections} from "./directions";

const directionNumberToName: Record<number, MapData.direction> = {
    1: "north",
    2: "northeast",
    3: "northwest",
    4: "east",
    5: "west",
    6: "south",
    7: "southeast",
    8: "southwest",
    9: "up",
    10: "down",
    11: "in",
    12: "out",
};

type AreaConnection = {
    fromAreaId: number;
    toAreaId: number;
    fromRoomId: number;
    toRoomId: number;
    direction: PlanarDirection | null;
    fromRoomPosition: {x: number; y: number};
    toRoomPosition: {x: number; y: number};
};

type AreaNode = {
    areaId: number;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    connections: AreaConnection[];
    roomCount: number;
};

type ConnectionGroup = {
    fromAreaId: number;
    toAreaId: number;
    connections: AreaConnection[];
    primaryDirection: PlanarDirection | null;
    averageOffset: {x: number; y: number};
};

export type AreaDomainInfo = {
    isIshtar: boolean;
    isEmpire: boolean;
};

export type DomainFilter = "ishtar" | "empire" | "interdomain" | "all";

export class AreaMapSettings {
    static areaWidth = 150;
    static areaHeight = 80;
    static areaSpacing = 50;
    static fontSize = 14;
    static connectionLineWidth = 2;
    static areaFillColor = "#2a2a3e";
    static areaStrokeColor = "#4a4a6e";
    static textColor = "#e0e0e0";
    static connectionColor = "#6a6a8e";
    static highlightColor = "#ff9900";
}

export class AreaMapRenderer {
    private readonly stage: Konva.Stage;
    private readonly areaLayer: Konva.Layer;
    private readonly connectionLayer: Konva.Layer;
    private readonly mapReader: MapReader;
    private areaNodes: Map<number, AreaNode> = new Map();
    private connectionGroups: ConnectionGroup[] = [];
    private currentZoom = 1;
    private highlightedArea?: number;
    private domainInfo: Map<number, AreaDomainInfo> = new Map();
    private domainFilter: DomainFilter = "all";

    constructor(container: HTMLDivElement, mapReader: MapReader) {
        this.stage = new Konva.Stage({
            container: container,
            width: container.clientWidth,
            height: container.clientHeight,
            draggable: true,
        });

        this.connectionLayer = new Konva.Layer({listening: false});
        this.stage.add(this.connectionLayer);

        this.areaLayer = new Konva.Layer();
        this.stage.add(this.areaLayer);

        this.mapReader = mapReader;

        this.initScaling();
        this.initResize(container);
    }

    private initResize(container: HTMLDivElement) {
        const resizeObserver = new ResizeObserver(() => {
            this.stage.width(container.clientWidth);
            this.stage.height(container.clientHeight);
            this.stage.batchDraw();
        });
        resizeObserver.observe(container);
    }

    private initScaling() {
        const scaleBy = 1.1;

        this.stage.on("wheel", (e) => {
            e.evt.preventDefault();

            const oldScale = this.stage.scaleX();
            const pointer = this.stage.getPointerPosition();
            if (!pointer) return;

            const mousePointTo = {
                x: (pointer.x - this.stage.x()) / oldScale,
                y: (pointer.y - this.stage.y()) / oldScale,
            };

            const direction = e.evt.deltaY > 0 ? -1 : 1;
            const newZoom = direction > 0 ? this.currentZoom * scaleBy : this.currentZoom / scaleBy;

            this.setZoom(newZoom);

            const newScale = this.stage.scaleX();
            const newPos = {
                x: pointer.x - mousePointTo.x * newScale,
                y: pointer.y - mousePointTo.y * newScale,
            };

            this.stage.position(newPos);
            this.stage.batchDraw();
        });
    }

    setZoom(zoom: number) {
        this.currentZoom = Math.max(0.1, Math.min(5, zoom));
        this.stage.scale({x: this.currentZoom, y: this.currentZoom});
    }

    getZoom() {
        return this.currentZoom;
    }

    setDomainInfo(domainInfo: Record<number, AreaDomainInfo>) {
        this.domainInfo.clear();
        for (const [areaId, info] of Object.entries(domainInfo)) {
            this.domainInfo.set(Number(areaId), info);
        }
    }

    setDomainFilter(filter: DomainFilter) {
        this.domainFilter = filter;
    }

    getDomainFilter() {
        return this.domainFilter;
    }

    private isAreaInDomain(areaId: number): boolean {
        const info = this.domainInfo.get(areaId);
        if (!info) {
            // If no domain info, only show in "interdomain" or "all"
            return this.domainFilter === "interdomain" || this.domainFilter === "all";
        }

        switch (this.domainFilter) {
            case "ishtar":
                return info.isIshtar;
            case "empire":
                return info.isEmpire;
            case "interdomain":
                return !info.isIshtar && !info.isEmpire;
            case "all":
                return true;
        }
    }

    private areAreasInSameDomain(areaId1: number, areaId2: number): boolean {
        const info1 = this.domainInfo.get(areaId1);
        const info2 = this.domainInfo.get(areaId2);

        if (!info1 || !info2) {
            return false;
        }

        // Both in Ishtar
        if (info1.isIshtar && info2.isIshtar) return true;
        // Both in Empire
        if (info1.isEmpire && info2.isEmpire) return true;
        // Both interdomain (neither Ishtar nor Empire)
        if (!info1.isIshtar && !info1.isEmpire && !info2.isIshtar && !info2.isEmpire) return true;

        return false;
    }

    render() {
        this.analyzeConnections();
        this.layoutAreas();
        this.drawConnections();
        this.drawAreas();
        this.centerView();
        this.stage.batchDraw();
    }

    private analyzeConnections() {
        this.areaNodes.clear();
        this.connectionGroups = [];

        const rooms = this.mapReader.getRooms();
        const areas = this.mapReader.getAreas();

        // Create area nodes (skip areas with no rooms and filter by domain)
        for (const area of areas) {
            const areaId = area.getAreaId();
            const roomCount = area.getRooms().length;
            if (roomCount === 0) {
                continue;
            }
            // Skip areas not in selected domain
            if (!this.isAreaInDomain(areaId)) {
                continue;
            }
            this.areaNodes.set(areaId, {
                areaId,
                name: area.getAreaName(),
                x: 0,
                y: 0,
                width: AreaMapSettings.areaWidth,
                height: AreaMapSettings.areaHeight,
                connections: [],
                roomCount,
            });
        }

        // Find cross-area connections
        const connectionMap = new Map<string, AreaConnection[]>();

        for (const room of rooms) {
            const fromAreaId = room.area;
            // Skip if source area has no rooms (not in our nodes)
            if (!this.areaNodes.has(fromAreaId)) continue;

            const lockedDirections = this.getLockedDirections(room);
            const lockedSpecialTargets = new Set(room.mSpecialExitLocks ?? []);

            // Check regular exits
            for (const [dir, targetRoomId] of Object.entries(room.exits ?? {})) {
                if (lockedDirections.has(dir as MapData.direction)) continue;

                const targetRoom = this.mapReader.getRoom(targetRoomId);
                if (!targetRoom || targetRoom.area === fromAreaId) continue;
                // Skip if target area has no rooms (not in our nodes)
                if (!this.areaNodes.has(targetRoom.area)) continue;
                // Skip cross-domain connections
                if (!this.areAreasInSameDomain(fromAreaId, targetRoom.area)) continue;

                const connection = this.createConnection(
                    room, targetRoom, dir as MapData.direction
                );
                if (connection) {
                    this.addConnection(connectionMap, connection);
                }
            }

            // Check special exits
            for (const [cmd, targetRoomId] of Object.entries(room.specialExits ?? {})) {
                if (lockedSpecialTargets.has(targetRoomId)) continue;

                const targetRoom = this.mapReader.getRoom(targetRoomId);
                if (!targetRoom || targetRoom.area === fromAreaId) continue;
                // Skip if target area has no rooms (not in our nodes)
                if (!this.areaNodes.has(targetRoom.area)) continue;
                // Skip cross-domain connections
                if (!this.areAreasInSameDomain(fromAreaId, targetRoom.area)) continue;

                const direction = this.parseDirection(cmd);
                const connection = this.createConnection(room, targetRoom, direction);
                if (connection) {
                    this.addConnection(connectionMap, connection);
                }
            }
        }

        // Group connections between same area pairs
        for (const [key, connections] of connectionMap) {
            const [fromId, toId] = key.split("-").map(Number);
            const group = this.createConnectionGroup(fromId, toId, connections);
            this.connectionGroups.push(group);

            const fromNode = this.areaNodes.get(fromId);
            const toNode = this.areaNodes.get(toId);
            if (fromNode) fromNode.connections.push(...connections);
            if (toNode) {
                // Add reverse connections
                for (const conn of connections) {
                    toNode.connections.push({
                        ...conn,
                        fromAreaId: conn.toAreaId,
                        toAreaId: conn.fromAreaId,
                        fromRoomId: conn.toRoomId,
                        toRoomId: conn.fromRoomId,
                        direction: conn.direction ? oppositeDirections[conn.direction] : null,
                        fromRoomPosition: conn.toRoomPosition,
                        toRoomPosition: conn.fromRoomPosition,
                    });
                }
            }
        }
    }

    private getLockedDirections(room: MapData.Room): Set<MapData.direction> {
        return new Set(
            (room.exitLocks ?? [])
                .map((lockId) => directionNumberToName[lockId])
                .filter((d): d is MapData.direction => Boolean(d))
        );
    }

    private createConnection(
        fromRoom: MapData.Room,
        toRoom: MapData.Room,
        direction: MapData.direction | null
    ): AreaConnection | null {
        const planarDir = this.toPlanarDirection(direction);

        return {
            fromAreaId: fromRoom.area,
            toAreaId: toRoom.area,
            fromRoomId: fromRoom.id,
            toRoomId: toRoom.id,
            direction: planarDir,
            fromRoomPosition: {x: fromRoom.x, y: fromRoom.y},
            toRoomPosition: {x: toRoom.x, y: toRoom.y},
        };
    }

    private addConnection(map: Map<string, AreaConnection[]>, conn: AreaConnection) {
        // Use consistent key ordering (smaller id first)
        const key = conn.fromAreaId < conn.toAreaId
            ? `${conn.fromAreaId}-${conn.toAreaId}`
            : `${conn.toAreaId}-${conn.fromAreaId}`;

        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key)!.push(conn);
    }

    private createConnectionGroup(
        fromAreaId: number,
        toAreaId: number,
        connections: AreaConnection[]
    ): ConnectionGroup {
        // Calculate primary direction based on most common direction
        const directionCounts = new Map<PlanarDirection, number>();
        let totalOffsetX = 0;
        let totalOffsetY = 0;

        for (const conn of connections) {
            if (conn.direction) {
                directionCounts.set(
                    conn.direction,
                    (directionCounts.get(conn.direction) ?? 0) + 1
                );
            }
            // Calculate offset based on room positions
            totalOffsetX += conn.toRoomPosition.x - conn.fromRoomPosition.x;
            totalOffsetY += conn.toRoomPosition.y - conn.fromRoomPosition.y;
        }

        let primaryDirection: PlanarDirection | null = null;
        let maxCount = 0;
        for (const [dir, count] of directionCounts) {
            if (count > maxCount) {
                maxCount = count;
                primaryDirection = dir;
            }
        }

        return {
            fromAreaId,
            toAreaId,
            connections,
            primaryDirection,
            averageOffset: {
                x: totalOffsetX / connections.length,
                y: totalOffsetY / connections.length,
            },
        };
    }

    private parseDirection(cmd: string): MapData.direction | null {
        const lower = cmd.toLowerCase().trim();
        const dirMap: Record<string, MapData.direction> = {
            n: "north", north: "north",
            s: "south", south: "south",
            e: "east", east: "east",
            w: "west", west: "west",
            ne: "northeast", northeast: "northeast",
            nw: "northwest", northwest: "northwest",
            se: "southeast", southeast: "southeast",
            sw: "southwest", southwest: "southwest",
            u: "up", up: "up",
            d: "down", down: "down",
            i: "in", in: "in",
            o: "out", out: "out",
        };
        return dirMap[lower] ?? null;
    }

    private toPlanarDirection(dir: MapData.direction | null): PlanarDirection | null {
        if (!dir) return null;
        if (planarDirections.includes(dir as PlanarDirection)) {
            return dir as PlanarDirection;
        }
        return null;
    }

    private layoutAreas() {
        const nodes = Array.from(this.areaNodes.values());
        if (nodes.length === 0) return;

        // Initialize all nodes with valid positions first
        let initX = 0;
        for (const node of nodes) {
            node.x = initX;
            node.y = 0;
            initX += AreaMapSettings.areaWidth + AreaMapSettings.areaSpacing;
        }

        // Find connected components
        const components = this.findConnectedComponents();

        // Layout each component separately
        let componentOffsetX = 0;
        const componentGap = AreaMapSettings.areaWidth * 3;

        for (const component of components) {
            if (component.length === 1) {
                // Single isolated area
                const node = this.areaNodes.get(component[0]);
                if (node) {
                    node.x = componentOffsetX;
                    node.y = 0;
                }
                componentOffsetX += AreaMapSettings.areaWidth + componentGap;
            } else {
                // Use force-directed layout for connected areas
                const bounds = this.forceDirectedLayout(component);

                // Shift component to start at componentOffsetX
                for (const areaId of component) {
                    const node = this.areaNodes.get(areaId);
                    if (node && isFinite(bounds.minX) && isFinite(bounds.minY)) {
                        node.x -= bounds.minX;
                        node.x += componentOffsetX;
                        node.y -= bounds.minY;
                    }
                }

                const width = isFinite(bounds.maxX - bounds.minX) ? bounds.maxX - bounds.minX : AreaMapSettings.areaWidth;
                componentOffsetX += width + componentGap;
            }
        }
    }

    private findConnectedComponents(): number[][] {
        const visited = new Set<number>();
        const components: number[][] = [];

        for (const [areaId] of this.areaNodes) {
            if (visited.has(areaId)) continue;

            const component: number[] = [];
            const queue = [areaId];

            while (queue.length > 0) {
                const current = queue.shift()!;
                if (visited.has(current)) continue;

                visited.add(current);
                component.push(current);

                const node = this.areaNodes.get(current);
                if (node) {
                    for (const conn of node.connections) {
                        if (!visited.has(conn.toAreaId)) {
                            queue.push(conn.toAreaId);
                        }
                    }
                }
            }

            components.push(component);
        }

        return components;
    }

    private forceDirectedLayout(areaIds: number[]): {minX: number; minY: number; maxX: number; maxY: number} {
        // Find unique connected areas for each node
        const connectionCount = new Map<number, Set<number>>();
        for (const id of areaIds) {
            const node = this.areaNodes.get(id);
            if (!node) continue;
            const connected = new Set(node.connections.map(c => c.toAreaId));
            connectionCount.set(id, connected);
        }

        // Hub detection: A hub is a node with 3+ connections (branching point)
        // Nodes with 1-2 connections are potential chain nodes
        // We need to trace chains and find their terminal hubs
        const hubNodes = new Set<number>();
        const processedInChain = new Set<number>();

        // First pass: mark obvious hubs (3+ connections)
        for (const [id, connected] of connectionCount) {
            if (connected.size >= 3) {
                hubNodes.add(id);
            }
        }

        // Second pass: find chains and identify their terminal hubs
        // A chain is a sequence of nodes each with <=2 connections
        // The chain ends at a hub (3+ connections) or a dead end (1 connection)
        for (const [startId, connected] of connectionCount) {
            if (hubNodes.has(startId) || processedInChain.has(startId)) continue;
            if (connected.size > 2) continue; // Already a hub

            // This node has 1-2 connections - trace the chain in both directions
            const chainMembers: number[] = [startId];
            processedInChain.add(startId);

            // Trace in both directions from this node
            const toVisit = Array.from(connected);
            for (const nextId of toVisit) {
                let currentId = nextId;
                let prevId = startId;

                while (currentId && !processedInChain.has(currentId) && !hubNodes.has(currentId)) {
                    const currentConnections = connectionCount.get(currentId);
                    if (!currentConnections) break;

                    if (currentConnections.size >= 3) {
                        // Found a hub at the end
                        hubNodes.add(currentId);
                        break;
                    }

                    chainMembers.push(currentId);
                    processedInChain.add(currentId);

                    // Find next node (not the one we came from)
                    let foundNext = false;
                    for (const neighborId of currentConnections) {
                        if (neighborId !== prevId && !processedInChain.has(neighborId)) {
                            prevId = currentId;
                            currentId = neighborId;
                            foundNext = true;
                            break;
                        }
                    }
                    if (!foundNext) break;
                }
            }

            // If chain has no hub connection, pick the first node as a pseudo-hub
            // (isolated chain or chain of single-connection nodes)
            let hasHubConnection = false;
            for (const memberId of chainMembers) {
                const memberConns = connectionCount.get(memberId);
                if (memberConns) {
                    for (const connId of memberConns) {
                        if (hubNodes.has(connId)) {
                            hasHubConnection = true;
                            break;
                        }
                    }
                }
                if (hasHubConnection) break;
            }

            if (!hasHubConnection && chainMembers.length > 0) {
                // Find the node with most connections to be the pseudo-hub
                let bestHub = chainMembers[0];
                let maxConns = connectionCount.get(chainMembers[0])?.size ?? 0;
                for (const memberId of chainMembers) {
                    const conns = connectionCount.get(memberId)?.size ?? 0;
                    if (conns > maxConns) {
                        maxConns = conns;
                        bestHub = memberId;
                    }
                }
                hubNodes.add(bestHub);
                processedInChain.delete(bestHub);
            }
        }

        // Also add any isolated nodes (0 connections) as their own hubs
        for (const id of areaIds) {
            const connected = connectionCount.get(id);
            if (!connected || connected.size === 0) {
                hubNodes.add(id);
            }
        }

        // Build chains from each hub
        const nodeToCluster = new Map<number, number>(); // maps node to its hub
        const clusterChains = new Map<number, number[][]>(); // hub -> array of chains

        for (const hubId of hubNodes) {
            nodeToCluster.set(hubId, hubId);
            clusterChains.set(hubId, []);
        }

        // For each hub, find chains emanating from it
        const assignedToChain = new Set<number>(hubNodes);

        for (const hubId of hubNodes) {
            const hubConnections = connectionCount.get(hubId) ?? new Set();

            for (const connectedId of hubConnections) {
                // If already assigned (another hub or already in a chain), skip
                if (assignedToChain.has(connectedId)) continue;

                // Build chain starting from this connection
                const chain: number[] = [];
                let currentId = connectedId;
                let prevId = hubId;

                while (currentId && !assignedToChain.has(currentId)) {
                    chain.push(currentId);
                    nodeToCluster.set(currentId, hubId);
                    assignedToChain.add(currentId);

                    // Find next in chain (the one connection that isn't where we came from)
                    const currentConnections = connectionCount.get(currentId) ?? new Set();
                    let nextId: number | undefined;
                    for (const nextConnId of currentConnections) {
                        if (nextConnId !== prevId && !assignedToChain.has(nextConnId)) {
                            nextId = nextConnId;
                            break;
                        }
                    }

                    prevId = currentId;
                    currentId = nextId!;
                }

                if (chain.length > 0) {
                    clusterChains.get(hubId)!.push(chain);
                }
            }
        }

        // Position hubs first using BFS
        const positioned = new Set<number>();
        const queue: number[] = [];

        // Start with first hub (or first node if no hubs)
        const firstHub = hubNodes.values().next().value;
        const startId = firstHub !== undefined ? firstHub : areaIds[0];
        if (startId !== undefined) {
            const startNode = this.areaNodes.get(startId);
            if (startNode) {
                startNode.x = 0;
                startNode.y = 0;
                positioned.add(startId);
                queue.push(startId);
            }
        }

        // BFS to position hubs based on directions
        while (queue.length > 0) {
            const currentId = queue.shift()!;
            const currentNode = this.areaNodes.get(currentId)!;

            for (const conn of currentNode.connections) {
                const targetId = conn.toAreaId;
                if (positioned.has(targetId)) continue;

                // Only position hubs in this pass
                if (!hubNodes.has(targetId)) continue;

                const targetNode = this.areaNodes.get(targetId);
                if (!targetNode) continue;

                const offset = this.getDirectionOffset(conn.direction);
                targetNode.x = currentNode.x + offset.x * (AreaMapSettings.areaWidth + AreaMapSettings.areaSpacing);
                targetNode.y = currentNode.y + offset.y * (AreaMapSettings.areaHeight + AreaMapSettings.areaSpacing);

                positioned.add(targetId);
                queue.push(targetId);
            }
        }

        // Apply forces only to hub nodes
        const hubArray = Array.from(hubNodes);
        if (hubArray.length > 1) {
            this.applyForces(hubArray, 80);
        }

        // Position chain nodes with appropriate distance based on direction
        // Add extra spacing to avoid overlaps with connection lines
        const horizontalDistance = AreaMapSettings.areaWidth + AreaMapSettings.areaSpacing + 30; // For east/west (230px)
        const verticalDistance = AreaMapSettings.areaHeight + AreaMapSettings.areaSpacing + 30; // For north/south (160px)

        // Store chain offsets relative to hub so we can reposition after hub moves
        const chainOffsets = new Map<number, {dx: number; dy: number; hubId: number}>();

        // Fallback directions for chains without explicit direction
        const fallbackDirections: PlanarDirection[] = [
            "east", "west", "north", "south",
            "northeast", "northwest", "southeast", "southwest"
        ];

        for (const [hubId, chains] of clusterChains) {
            const hubNode = this.areaNodes.get(hubId);
            if (!hubNode) continue;

            // Track which fallback direction to use for null-direction chains
            let fallbackIndex = 0;

            // Track how many chains use each direction to offset duplicates
            const directionUsageCount = new Map<string, number>();

            for (const chain of chains) {
                let prevId = hubId;
                let prevX = hubNode.x;
                let prevY = hubNode.y;
                let chainFallbackDirection: PlanarDirection | null = null;

                for (const chainNodeId of chain) {
                    const chainNode = this.areaNodes.get(chainNodeId);
                    if (!chainNode) continue;

                    // Find direction from prev to this chain node
                    const prevNodeData = this.areaNodes.get(prevId);
                    let direction: PlanarDirection | null = null;
                    if (prevNodeData) {
                        for (const conn of prevNodeData.connections) {
                            if (conn.toAreaId === chainNodeId) {
                                direction = conn.direction;
                                break;
                            }
                        }
                    }

                    // If no direction and this is first node in chain, use fallback
                    if (!direction && prevId === hubId) {
                        chainFallbackDirection = fallbackDirections[fallbackIndex % fallbackDirections.length];
                        fallbackIndex++;
                        direction = chainFallbackDirection;
                    } else if (!direction && chainFallbackDirection) {
                        // Continue in same fallback direction for rest of chain
                        direction = chainFallbackDirection;
                    }

                    // Position relative to previous node with direction-appropriate distance
                    const offset = this.getDirectionOffset(direction);

                    // Check if this is first node in chain from hub - apply stacking offset for same direction
                    let stackOffset = 0;
                    if (prevId === hubId && direction) {
                        const dirKey = direction;
                        const usageCount = directionUsageCount.get(dirKey) ?? 0;
                        directionUsageCount.set(dirKey, usageCount + 1);
                        stackOffset = usageCount;
                    }

                    // Use horizontal distance for x component, vertical for y component
                    chainNode.x = prevX + offset.x * horizontalDistance;
                    chainNode.y = prevY + offset.y * verticalDistance;

                    // Apply perpendicular offset if multiple chains in same direction
                    if (stackOffset > 0) {
                        // Offset perpendicular to the direction - use full area size + extra spacing
                        const extraPadding = 1.2; // 20% extra spacing for multi-satellite hubs
                        if (offset.x !== 0 && offset.y === 0) {
                            // Horizontal direction - offset vertically
                            chainNode.y += stackOffset * verticalDistance * extraPadding;
                        } else if (offset.y !== 0 && offset.x === 0) {
                            // Vertical direction - offset horizontally
                            chainNode.x += stackOffset * horizontalDistance * extraPadding;
                        } else {
                            // Diagonal - offset along the perpendicular diagonal (full spacing)
                            chainNode.x += stackOffset * horizontalDistance * extraPadding;
                            chainNode.y -= stackOffset * verticalDistance * extraPadding;
                        }
                    }

                    // Store offset from hub for later repositioning
                    chainOffsets.set(chainNodeId, {
                        dx: chainNode.x - hubNode.x,
                        dy: chainNode.y - hubNode.y,
                        hubId
                    });

                    prevId = chainNodeId;
                    prevX = chainNode.x;
                    prevY = chainNode.y;
                }
            }
        }

        // Calculate cluster bounds for each hub (hub + all its chains)
        const clusterBounds = new Map<number, {minX: number; minY: number; maxX: number; maxY: number}>();
        const clusterBoundsOffsets = new Map<number, {dx: number; dy: number}>();

        for (const hubId of hubNodes) {
            const hubNode = this.areaNodes.get(hubId);
            if (!hubNode) continue;

            let minX = hubNode.x;
            let minY = hubNode.y;
            let maxX = hubNode.x + hubNode.width;
            let maxY = hubNode.y + hubNode.height;

            const chains = clusterChains.get(hubId) ?? [];
            for (const chain of chains) {
                for (const chainNodeId of chain) {
                    const chainNode = this.areaNodes.get(chainNodeId);
                    if (!chainNode) continue;
                    minX = Math.min(minX, chainNode.x);
                    minY = Math.min(minY, chainNode.y);
                    maxX = Math.max(maxX, chainNode.x + chainNode.width);
                    maxY = Math.max(maxY, chainNode.y + chainNode.height);
                }
            }

            clusterBounds.set(hubId, {minX, minY, maxX, maxY});
            // Store offset from hub origin to bounds origin
            clusterBoundsOffsets.set(hubId, {dx: minX - hubNode.x, dy: minY - hubNode.y});
        }

        // Apply forces only to hubs, using cluster bounds for collision
        this.applyClusterForces(hubArray, clusterBounds, clusterBoundsOffsets, 60);

        // Reposition chain nodes based on updated hub positions
        for (const [chainNodeId, offset] of chainOffsets) {
            const chainNode = this.areaNodes.get(chainNodeId);
            const hubNode = this.areaNodes.get(offset.hubId);
            if (!chainNode || !hubNode) continue;

            chainNode.x = hubNode.x + offset.dx;
            chainNode.y = hubNode.y + offset.dy;
        }

        // Calculate bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const areaId of areaIds) {
            const node = this.areaNodes.get(areaId)!;
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + node.width);
            maxY = Math.max(maxY, node.y + node.height);
        }

        return {minX, minY, maxX, maxY};
    }

    private getDirectionOffset(direction: PlanarDirection | null): {x: number; y: number} {
        // Use 0.75 for diagonals to keep them compact but not overlapping
        const offsets: Record<PlanarDirection, {x: number; y: number}> = {
            north: {x: 0, y: -1},
            south: {x: 0, y: 1},
            east: {x: 1, y: 0},
            west: {x: -1, y: 0},
            northeast: {x: 0.75, y: -0.75},
            northwest: {x: -0.75, y: -0.75},
            southeast: {x: 0.75, y: 0.75},
            southwest: {x: -0.75, y: 0.75},
        };

        if (direction && offsets[direction]) {
            return offsets[direction];
        }

        // Default: random-ish offset for non-directional connections
        return {x: 1, y: 0};
    }

    private applyClusterForces(
        hubIds: number[],
        clusterBounds: Map<number, {minX: number; minY: number; maxX: number; maxY: number}>,
        clusterOffsets: Map<number, {dx: number; dy: number}>, // offset from hub origin to cluster bounds origin
        iterations: number
    ) {
        const damping = 0.8;
        const padding = 50; // Extra space between clusters

        const velocities = new Map<number, {vx: number; vy: number}>();
        for (const id of hubIds) {
            velocities.set(id, {vx: 0, vy: 0});
        }

        for (let iter = 0; iter < iterations; iter++) {
            // Update cluster bounds based on current hub positions
            for (const hubId of hubIds) {
                const hubNode = this.areaNodes.get(hubId);
                const bounds = clusterBounds.get(hubId);
                const offset = clusterOffsets.get(hubId);
                if (!hubNode || !bounds || !offset) continue;

                const width = bounds.maxX - bounds.minX;
                const height = bounds.maxY - bounds.minY;

                bounds.minX = hubNode.x + offset.dx;
                bounds.minY = hubNode.y + offset.dy;
                bounds.maxX = bounds.minX + width;
                bounds.maxY = bounds.minY + height;
            }

            for (const id of hubIds) {
                const node = this.areaNodes.get(id);
                const vel = velocities.get(id);
                const bounds = clusterBounds.get(id);
                if (!node || !vel || !bounds) continue;

                // Repulsion from other clusters using AABB overlap check
                for (const otherId of hubIds) {
                    if (id === otherId) continue;
                    const otherBounds = clusterBounds.get(otherId);
                    if (!otherBounds) continue;

                    // Calculate centers
                    const cx1 = (bounds.minX + bounds.maxX) / 2;
                    const cy1 = (bounds.minY + bounds.maxY) / 2;
                    const cx2 = (otherBounds.minX + otherBounds.maxX) / 2;
                    const cy2 = (otherBounds.minY + otherBounds.maxY) / 2;

                    const dx = cx1 - cx2;
                    const dy = cy1 - cy2;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

                    // Required distance based on actual rectangles (half-widths and half-heights)
                    const hw1 = (bounds.maxX - bounds.minX) / 2;
                    const hh1 = (bounds.maxY - bounds.minY) / 2;
                    const hw2 = (otherBounds.maxX - otherBounds.minX) / 2;
                    const hh2 = (otherBounds.maxY - otherBounds.minY) / 2;

                    // Minimum distance to avoid overlap (axis-aligned rectangles)
                    const sepX = hw1 + hw2 + padding;
                    const sepY = hh1 + hh2 + padding;

                    // Check if overlapping
                    const overlapX = sepX - Math.abs(dx);
                    const overlapY = sepY - Math.abs(dy);

                    if (overlapX > 0 && overlapY > 0) {
                        // Overlapping - push apart along the axis with smaller overlap
                        if (overlapX < overlapY) {
                            const pushX = overlapX * (dx >= 0 ? 1 : -1) * 0.5;
                            vel.vx += pushX;
                        } else {
                            const pushY = overlapY * (dy >= 0 ? 1 : -1) * 0.5;
                            vel.vy += pushY;
                        }
                    }
                }

                // Spring force toward connected hubs (gentle)
                for (const conn of node.connections) {
                    const other = this.areaNodes.get(conn.toAreaId);
                    if (!other || !hubIds.includes(conn.toAreaId)) continue;

                    const dx = other.x - node.x;
                    const dy = other.y - node.y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

                    const idealDistance = AreaMapSettings.areaWidth + AreaMapSettings.areaSpacing + 50;
                    const displacement = dist - idealDistance;
                    const springForce = displacement * 0.015;
                    vel.vx += (dx / dist) * springForce;
                    vel.vy += (dy / dist) * springForce;
                }
            }

            // Apply velocities
            for (const id of hubIds) {
                const node = this.areaNodes.get(id);
                const vel = velocities.get(id);
                if (!node || !vel) continue;

                node.x += vel.vx;
                node.y += vel.vy;

                vel.vx *= damping;
                vel.vy *= damping;
            }
        }
    }

    private applyForces(areaIds: number[], iterations: number) {
        const damping = 0.8;
        const padding = 20; // Minimum gap between areas
        const idealDistance = AreaMapSettings.areaWidth + AreaMapSettings.areaSpacing; // 200px - same as chain spacing
        const lineAvoidanceDistance = AreaMapSettings.areaWidth / 2 + 60; // Increased to push nodes further from lines

        // Build list of edges for line avoidance (only between nodes in areaIds)
        const areaIdSet = new Set(areaIds);
        const edges: Array<{from: number; to: number}> = [];
        const edgeSet = new Set<string>();
        for (const id of areaIds) {
            const node = this.areaNodes.get(id);
            if (!node) continue;
            for (const conn of node.connections) {
                if (!areaIdSet.has(conn.toAreaId)) continue;
                const key = Math.min(id, conn.toAreaId) + "-" + Math.max(id, conn.toAreaId);
                if (!edgeSet.has(key)) {
                    edgeSet.add(key);
                    edges.push({from: id, to: conn.toAreaId});
                }
            }
        }

        const velocities = new Map<number, {vx: number; vy: number}>();
        for (const id of areaIds) {
            velocities.set(id, {vx: 0, vy: 0});
        }

        for (let iter = 0; iter < iterations; iter++) {
            // Calculate forces
            for (const id of areaIds) {
                const node = this.areaNodes.get(id);
                const vel = velocities.get(id);
                if (!node || !vel) continue;

                const nodeCenterX = node.x + node.width / 2;
                const nodeCenterY = node.y + node.height / 2;

                // Repulsion from other nodes using AABB overlap detection
                for (const otherId of areaIds) {
                    if (id === otherId) continue;
                    const other = this.areaNodes.get(otherId);
                    if (!other) continue;

                    // Calculate required separation (half-widths + half-heights + padding)
                    const minSepX = (node.width + other.width) / 2 + padding;
                    const minSepY = (node.height + other.height) / 2 + padding;

                    // Calculate center-to-center distance
                    const cx1 = node.x + node.width / 2;
                    const cy1 = node.y + node.height / 2;
                    const cx2 = other.x + other.width / 2;
                    const cy2 = other.y + other.height / 2;

                    const dx = cx1 - cx2;
                    const dy = cy1 - cy2;

                    // Check overlap on each axis
                    const overlapX = minSepX - Math.abs(dx);
                    const overlapY = minSepY - Math.abs(dy);

                    if (overlapX > 0 && overlapY > 0) {
                        // Overlapping - push apart along the axis with smaller overlap
                        if (overlapX < overlapY) {
                            vel.vx += (dx >= 0 ? 1 : -1) * overlapX * 0.5;
                        } else {
                            vel.vy += (dy >= 0 ? 1 : -1) * overlapY * 0.5;
                        }
                    }
                }

                // Repulsion from edges (lines) that this node is not part of
                for (const edge of edges) {
                    if (edge.from === id || edge.to === id) continue;

                    const fromNode = this.areaNodes.get(edge.from);
                    const toNode = this.areaNodes.get(edge.to);
                    if (!fromNode || !toNode) continue;

                    const fromX = fromNode.x + fromNode.width / 2;
                    const fromY = fromNode.y + fromNode.height / 2;
                    const toX = toNode.x + toNode.width / 2;
                    const toY = toNode.y + toNode.height / 2;

                    const closest = this.closestPointOnSegment(
                        nodeCenterX, nodeCenterY,
                        fromX, fromY, toX, toY
                    );

                    const dx = nodeCenterX - closest.x;
                    const dy = nodeCenterY - closest.y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

                    if (dist < lineAvoidanceDistance) {
                        const repulsion = (lineAvoidanceDistance - dist) * 0.6; // Stronger push away from lines
                        vel.vx += (dx / dist) * repulsion;
                        vel.vy += (dy / dist) * repulsion;
                    }
                }

                // Spring force for connected nodes
                for (const conn of node.connections) {
                    if (!areaIdSet.has(conn.toAreaId)) continue;
                    const other = this.areaNodes.get(conn.toAreaId);
                    if (!other) continue;

                    const dx = other.x - node.x;
                    const dy = other.y - node.y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

                    const displacement = dist - idealDistance;
                    const springForce = displacement * 0.03;
                    vel.vx += (dx / dist) * springForce;
                    vel.vy += (dy / dist) * springForce;

                    // Directional hint
                    const targetOffset = this.getDirectionOffset(conn.direction);
                    const idealX = node.x + targetOffset.x * idealDistance;
                    const idealY = node.y + targetOffset.y * idealDistance;

                    const otherVel = velocities.get(conn.toAreaId);
                    if (otherVel) {
                        otherVel.vx += (idealX - other.x) * 0.01;
                        otherVel.vy += (idealY - other.y) * 0.01;
                    }
                }
            }

            // Apply velocities with damping
            for (const id of areaIds) {
                const node = this.areaNodes.get(id);
                const vel = velocities.get(id);
                if (!node || !vel) continue;

                node.x += vel.vx;
                node.y += vel.vy;

                vel.vx *= damping;
                vel.vy *= damping;
            }
        }
    }

    private closestPointOnSegment(
        px: number, py: number,
        ax: number, ay: number,
        bx: number, by: number
    ): {x: number; y: number} {
        const abx = bx - ax;
        const aby = by - ay;
        const apx = px - ax;
        const apy = py - ay;

        const abLenSq = abx * abx + aby * aby;
        if (abLenSq === 0) {
            return {x: ax, y: ay};
        }

        let t = (apx * abx + apy * aby) / abLenSq;
        t = Math.max(0, Math.min(1, t));

        return {
            x: ax + t * abx,
            y: ay + t * aby,
        };
    }

    private edgesIntersect(
        ax: number, ay: number, bx: number, by: number,
        cx: number, cy: number, dx: number, dy: number
    ): boolean {
        // Check if line segment AB intersects with line segment CD
        const ccw = (p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number) => {
            return (p3y - p1y) * (p2x - p1x) > (p2y - p1y) * (p3x - p1x);
        };

        return (
            ccw(ax, ay, cx, cy, dx, dy) !== ccw(bx, by, cx, cy, dx, dy) &&
            ccw(ax, ay, bx, by, cx, cy) !== ccw(ax, ay, bx, by, dx, dy)
        );
    }

    private drawConnections() {
        this.connectionLayer.destroyChildren();

        for (const group of this.connectionGroups) {
            const fromNode = this.areaNodes.get(group.fromAreaId);
            const toNode = this.areaNodes.get(group.toAreaId);
            if (!fromNode || !toNode) continue;

            // Skip if positions are invalid
            if (!isFinite(fromNode.x) || !isFinite(fromNode.y) ||
                !isFinite(toNode.x) || !isFinite(toNode.y)) {
                continue;
            }

            const fromCenter = {
                x: fromNode.x + fromNode.width / 2,
                y: fromNode.y + fromNode.height / 2,
            };
            const toCenter = {
                x: toNode.x + toNode.width / 2,
                y: toNode.y + toNode.height / 2,
            };

            // Draw line from edge to edge
            const fromEdge = this.getEdgePoint(fromNode, toCenter);
            const toEdge = this.getEdgePoint(toNode, fromCenter);

            // Skip if edge points are invalid
            if (!isFinite(fromEdge.x) || !isFinite(fromEdge.y) ||
                !isFinite(toEdge.x) || !isFinite(toEdge.y)) {
                continue;
            }

            const line = new Konva.Line({
                points: [fromEdge.x, fromEdge.y, toEdge.x, toEdge.y],
                stroke: AreaMapSettings.connectionColor,
                strokeWidth: Math.min(AreaMapSettings.connectionLineWidth, 1 + group.connections.length * 0.5),
                lineCap: "round",
                listening: false,
            });

            this.connectionLayer.add(line);
        }
    }

    private getEdgePoint(node: AreaNode, target: {x: number; y: number}): {x: number; y: number} {
        const cx = node.x + node.width / 2;
        const cy = node.y + node.height / 2;

        const dx = target.x - cx;
        const dy = target.y - cy;

        const hw = node.width / 2;
        const hh = node.height / 2;

        // Calculate intersection with rectangle edges
        if (dx === 0 && dy === 0) {
            return {x: cx, y: cy};
        }

        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        let scale: number;
        if (absDx / hw > absDy / hh) {
            scale = hw / absDx;
        } else {
            scale = hh / absDy;
        }

        return {
            x: cx + dx * scale,
            y: cy + dy * scale,
        };
    }

    private drawAreas() {
        this.areaLayer.destroyChildren();

        for (const [, node] of this.areaNodes) {
            // Skip if position is invalid
            if (!isFinite(node.x) || !isFinite(node.y)) {
                continue;
            }

            const group = new Konva.Group({
                x: node.x,
                y: node.y,
                draggable: true,
            });

            const isHighlighted = node.areaId === this.highlightedArea;

            const rect = new Konva.Rect({
                width: node.width,
                height: node.height,
                fill: AreaMapSettings.areaFillColor,
                stroke: isHighlighted ? AreaMapSettings.highlightColor : AreaMapSettings.areaStrokeColor,
                strokeWidth: isHighlighted ? 3 : 2,
                cornerRadius: 8,
            });

            const name = new Konva.Text({
                text: node.name,
                fontSize: AreaMapSettings.fontSize,
                fill: AreaMapSettings.textColor,
                width: node.width - 10,
                height: node.height - 20,
                x: 5,
                y: 10,
                align: "center",
                verticalAlign: "middle",
                ellipsis: true,
                wrap: "word",
            });

            const roomCount = new Konva.Text({
                text: `${node.roomCount} rooms`,
                fontSize: 10,
                fill: AreaMapSettings.connectionColor,
                width: node.width - 10,
                x: 5,
                y: node.height - 18,
                align: "center",
            });

            group.add(rect);
            group.add(name);
            group.add(roomCount);

            // Add click handler
            group.on("click tap", () => {
                this.emitAreaClickEvent(node.areaId);
            });

            group.on("mouseenter", () => {
                this.stage.container().style.cursor = "pointer";
                rect.stroke(AreaMapSettings.highlightColor);
                this.areaLayer.batchDraw();
            });

            group.on("mouseleave", () => {
                this.stage.container().style.cursor = "auto";
                rect.stroke(isHighlighted ? AreaMapSettings.highlightColor : AreaMapSettings.areaStrokeColor);
                this.areaLayer.batchDraw();
            });

            group.on("dragmove", () => {
                node.x = group.x();
                node.y = group.y();
                this.drawConnections();
                this.connectionLayer.batchDraw();
            });

            group.on("dragstart", () => {
                this.stage.container().style.cursor = "grabbing";
            });

            group.on("dragend", () => {
                this.stage.container().style.cursor = "pointer";
            });

            this.areaLayer.add(group);
        }
    }

    private centerView() {
        // Calculate bounds of all areas
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const [, node] of this.areaNodes) {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + node.width);
            maxY = Math.max(maxY, node.y + node.height);
        }

        if (!isFinite(minX)) return;

        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;
        const centerX = minX + contentWidth / 2;
        const centerY = minY + contentHeight / 2;

        // Calculate zoom to fit
        const padding = 50;
        const scaleX = (this.stage.width() - padding * 2) / contentWidth;
        const scaleY = (this.stage.height() - padding * 2) / contentHeight;
        const fitZoom = Math.min(scaleX, scaleY, 1.5);

        this.setZoom(fitZoom);

        // Center the view
        const scale = this.stage.scaleX();
        this.stage.position({
            x: this.stage.width() / 2 - centerX * scale,
            y: this.stage.height() / 2 - centerY * scale,
        });
    }

    highlightArea(areaId: number | undefined) {
        this.highlightedArea = areaId;
        this.drawAreas();
        this.stage.batchDraw();
    }

    centerOnArea(areaId: number) {
        const node = this.areaNodes.get(areaId);
        if (!node) return;

        const scale = this.stage.scaleX();
        const centerX = node.x + node.width / 2;
        const centerY = node.y + node.height / 2;

        this.stage.position({
            x: this.stage.width() / 2 - centerX * scale,
            y: this.stage.height() / 2 - centerY * scale,
        });

        this.stage.batchDraw();
    }

    private emitAreaClickEvent(areaId: number) {
        const event = new CustomEvent<{areaId: number}>("areaclick", {
            detail: {areaId},
        });
        this.stage.container().dispatchEvent(event);
    }

    getAreaNode(areaId: number): AreaNode | undefined {
        return this.areaNodes.get(areaId);
    }

    getConnectionGroups(): ConnectionGroup[] {
        return this.connectionGroups;
    }

    destroy() {
        this.stage.destroy();
    }
}
