export type Kind = "exit" | "specialExit";

export default interface Exit {
    a: number;
    b: number;
    aDir?: MapData.direction;
    bDir?: MapData.direction;
    kind?: Kind;
    zIndex: number[];
}
