SVG view bounds = camera
multiple backends in MapRenderer - questionable, we might want to crete SVGBackend in place just to create export SVG if needed
SVGRenderer - cast of MapRenderer to verify
Resize window, div - might go to camera
move commands out of KonvaBackend
Culling manager - we might need instance per camera and drawing backend, not to just setcamera on cullingManager