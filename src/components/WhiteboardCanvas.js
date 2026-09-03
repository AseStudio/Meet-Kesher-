import 'react-native-get-random-values'; // required so uuid works on RN — npm i react-native-get-random-values
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  ScrollView,
  Dimensions,
  Modal,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import Svg, { Path, Rect, Circle, Line, Text as SvgText, G } from 'react-native-svg';
import {
  PinchGestureHandler,
  PanGestureHandler,
  State as GestureState,
} from 'react-native-gesture-handler';
import { getStroke } from 'perfect-freehand';
import { v4 as uuidv4 } from 'uuid';
import { captureRef } from 'react-native-view-shot';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { supabase } from '../lib/supabase';
import { useResponsive } from '../lib/responsive';

/**
 * WhiteboardCanvas
 * ----------------
 * Reusable board component (upgrade #17 / "the biggest recommendation").
 * This is NOT a screen. It takes no `navigation`/`route` props, so it can be
 * dropped into SessionMain (or any other container) instead of navigated to.
 *
 *   <WhiteboardCanvas
 *     session={session}
 *     currentUser={{ id: myId, name: myName }}
 *     isHost={isHost}
 *     canDraw={hostOrAttendeeDrawPermission} // now respected for the host too — the
 *                                             // caller decides whether the host can draw
 *                                             // right now (e.g. false while someone else
 *                                             // is called to the board, true while the
 *                                             // host is "interrupting")
 *     visible={boardVisible}                // controls the "embedded" panel's visibility
 *     mode="embedded"                        // "embedded" | "fullscreen"
 *     onRequestClose={() => setBoardVisible(false)}
 *   />
 *
 * A thin WhiteboardScreen wrapper (bottom of file, commented) shows how to keep
 * the old standalone-screen behavior for anywhere you still navigate to it directly.
 */

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const ERASE_THRESHOLD = 26;
const LASER_FADE_MS = 2000;
const CURSOR_THROTTLE_MS = 90;
const CURSOR_IDLE_MS = 1500;

const penColors = ['#000000', '#5B2EFF', '#FF3B3B', '#2ECC71', '#F5A623', '#00BCD4', '#FF69B4'];
const chalkColors = ['#FFFFFF', '#FFD700', '#FF9EBC', '#87CEEB', '#98FF98', '#FF8C69', '#DDA0DD'];
const brushSizes = [2, 4, 8, 14];

// One drawing component, two looks (#4 in the review talked about pages —
// this is the same idea applied to Whiteboard vs Blackboard: same engine,
// different skin, instead of two copies of the same 900 lines of logic).
const THEMES = {
  whiteboard: {
    label: 'Whiteboard',
    canvasBg: '#FAFAFA',
    containerBg: colors.white,
    topBarBg: colors.white,
    topBarBorder: colors.greyLight,
    textColor: colors.text,
    subtleText: 'rgba(0,0,0,0.5)',
    accent: colors.primary,
    accentSoft: '#F0ECFF',
    palette: penColors,
    defaultColor: '#000000',
    toolbarBg: colors.white,
    toolbarBorder: colors.greyLight,
    toolBg: '#F4F3FA',
    toolBorder: colors.greyLight,
    toolIconColor: colors.text,
    toolLabelColor: colors.textLight,
    toolIconColorActive: colors.white,
    toolLabelColorActive: colors.white,
    panelBg: colors.white,
    panelBorder: colors.greyLight,
    swatchBorder: '#E2E0F2',
    penToolLabel: 'Pen',
    shadow: true,
  },
  blackboard: {
    label: 'Blackboard',
    canvasBg: '#2D5A2D',
    containerBg: '#173317',
    topBarBg: '#123112',
    topBarBorder: '#2E5C2E',
    textColor: '#FFFFFF',
    subtleText: 'rgba(255,255,255,0.6)',
    accent: '#4FA84F',
    accentSoft: 'rgba(79,168,79,0.22)',
    palette: chalkColors,
    defaultColor: '#FFFFFF',
    toolbarBg: '#123112',
    toolbarBorder: '#2E5C2E',
    toolBg: 'rgba(255,255,255,0.08)',
    toolBorder: 'rgba(255,255,255,0.12)',
    toolIconColor: 'rgba(255,255,255,0.85)',
    toolLabelColor: 'rgba(255,255,255,0.6)',
    toolIconColorActive: '#0F2A0F',
    toolLabelColorActive: '#0F2A0F',
    panelBg: '#173317',
    panelBorder: 'rgba(255,255,255,0.12)',
    swatchBorder: 'rgba(255,255,255,0.25)',
    penToolLabel: 'Chalk',
    shadow: false,
  },
};

const SHAPE_TOOLS = ['rect', 'circle', 'line', 'arrow', 'text'];

// Real iconography instead of emoji glyphs — emoji render inconsistently
// across iOS/Android/web (different glyph sets, sizes, baseline offsets),
// which is what made the old toolbar look unpolished/basic. One lookup
// table so every tool button, in every theme, draws from the same icon
// set as the rest of the app (Ionicons/MaterialCommunityIcons, same as
// lib/iconMeta.js).
function ToolIcon({ name, size, color }) {
  const MCI_ICONS = {
    highlighter: 'marker',
    eraser: 'eraser-variant',
    text: 'format-text',
    line: 'vector-line',
  };
  if (MCI_ICONS[name]) {
    return <MaterialCommunityIcons name={MCI_ICONS[name]} size={size} color={color} />;
  }
  const ION_ICONS = {
    pen: 'pencil',
    shapes: 'shapes-outline',
    rect: 'square-outline',
    circle: 'ellipse-outline',
    arrow: 'arrow-forward-outline',
    laser: 'flashlight-outline',
    select: 'move-outline',
    undo: 'arrow-undo-outline',
    redo: 'arrow-redo-outline',
    clear: 'trash-outline',
    save: 'download-outline',
    resetView: 'scan-outline',
    image: 'image-outline',
    document: 'document-text-outline',
    lockClosed: 'lock-closed-outline',
    lockOpen: 'lock-open-outline',
    close: 'close-outline',
    add: 'add-outline',
    chevronDown: 'chevron-down-outline',
    back: 'arrow-back-outline',
    minimize: 'chevron-down-outline',
  };
  return <Ionicons name={ION_ICONS[name] || 'ellipse-outline'} size={size} color={color} />;
}

// ---------------------------------------------------------------------------
// Geometry / smoothing helpers
// ---------------------------------------------------------------------------

// Turns perfect-freehand's outline points into a smooth, fillable SVG path.
// (This is the standard perfect-freehand recipe — see their README.)
function getSvgPathFromOutline(points) {
  if (!points.length) return '';
  const d = points.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0.toFixed(1), y0.toFixed(1), ((x0 + x1) / 2).toFixed(1), ((y0 + y1) / 2).toFixed(1));
      return acc;
    },
    ['M', points[0][0].toFixed(1), points[0][1].toFixed(1), 'Q']
  );
  d.push('Z');
  return d.join(' ');
}

function smoothStroke(rawPoints, size) {
  const outline = getStroke(rawPoints, {
    size,
    thinning: 0.55,
    smoothing: 0.5,
    streamline: 0.5,
  });
  return getSvgPathFromOutline(outline);
}

function distToSegment(p, v, w) {
  const [px, py] = p;
  const [vx, vy] = v;
  const [wx, wy] = w;
  const l2 = (vx - wx) ** 2 + (vy - wy) ** 2;
  if (l2 === 0) return Math.hypot(px - vx, py - vy);
  let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = vx + t * (wx - vx);
  const projY = vy + t * (wy - vy);
  return Math.hypot(px - projX, py - projY);
}

// Object-level hit test used by the eraser tool and the selection tool.
// This replaces "paint white" erasing (#12) with real removal of the object.
function strokeHitAtPoint(stroke, point, threshold = ERASE_THRESHOLD) {
  if (stroke.type === 'freehand' && stroke.points?.length) {
    for (let i = 1; i < stroke.points.length; i++) {
      if (distToSegment(point, stroke.points[i - 1], stroke.points[i]) < threshold) return true;
    }
    return false;
  }
  if (['rect', 'circle', 'line', 'arrow', 'text'].includes(stroke.type)) {
    const minX = Math.min(stroke.x1, stroke.x2) - threshold;
    const maxX = Math.max(stroke.x1, stroke.x2) + threshold;
    const minY = Math.min(stroke.y1, stroke.y2) - threshold;
    const maxY = Math.max(stroke.y1, stroke.y2) + threshold;
    return point[0] >= minX && point[0] <= maxX && point[1] >= minY && point[1] <= maxY;
  }
  return false;
}

function escapeXml(s = '') {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function strokeToSvgMarkup(s) {
  const opacity = s.opacity ?? 1;
  switch (s.type) {
    case 'freehand':
      return `<path d="${s.d}" fill="${s.color}" opacity="${opacity}"/>`;
    case 'rect': {
      const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
      const w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${s.color}" stroke-width="${s.width}" fill="none"/>`;
    }
    case 'circle': {
      const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
      const r = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / 2;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="${s.color}" stroke-width="${s.width}" fill="none"/>`;
    }
    case 'line':
    case 'arrow':
      return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${s.color}" stroke-width="${s.width}"/>`;
    case 'text':
      return `<text x="${s.x1}" y="${s.y1}" fill="${s.color}" font-size="${(s.width || 4) * 6}">${escapeXml(s.text || '')}</text>`;
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WhiteboardCanvas({
  session,
  currentUser,
  isHost = false,
  canDraw = true,
  visible = true,
  mode = 'fullscreen', // 'fullscreen' | 'embedded'
  theme = 'whiteboard', // 'whiteboard' | 'blackboard'
  boardType, // defaults to `theme` — lets whiteboard & blackboard share a session without mixing pages/strokes
  onRequestClose,
}) {
  const T = THEMES[theme] || THEMES.whiteboard;
  const boardKind = boardType || theme;
  const sessionId = session?.id;
  const userId = currentUser?.id ?? 'me';
  const userName = currentUser?.name ?? 'You';
  const { scale } = useResponsive();

  // ---- Pages / boards (#4) -------------------------------------------------
  const [pages, setPages] = useState([]);
  const [activePageId, setActivePageId] = useState(null);
  const [pagesMenuOpen, setPagesMenuOpen] = useState(false);

  // ---- Strokes for the active page ----------------------------------------
  const [strokes, setStrokes] = useState([]);
  const [currentPath, setCurrentPath] = useState(''); // live raw preview while drawing

  // ---- Tools ----------------------------------------------------------------
  const [activeTool, setActiveTool] = useState('pen');
  const [activeColor, setActiveColor] = useState(T.defaultColor);
  const [activeBrush, setActiveBrush] = useState(4);
  const [shapesMenuOpen, setShapesMenuOpen] = useState(false);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);

  // ---- Permissions / lock (#1, #13) -----------------------------------------
  const [boardLocked, setBoardLocked] = useState(false);
  // Draw permission: attendees follow canDraw + the host's board lock.
  // The host does NOT automatically get to draw anymore — when someone
  // else has been called to the board and accepted, the host is put in
  // view-only mode too (see SessionMain's hostCanDraw / Interrupt logic),
  // and only regains editing while actively interrupting. The host still
  // bypasses `boardLocked` since that lock is meant to restrict attendees,
  // not the host themselves.
  const effectiveCanDraw = isHost ? canDraw : (canDraw && !boardLocked);

  // ---- Selection tool (#7) ----------------------------------------------------
  const [selectedId, setSelectedId] = useState(null);

  // ---- Laser pointer (#6) — pure live pointer, no drawn/fading trail -----------
  const [laserPath, setLaserPath] = useState(null); // { d, color } | null — kept only for the realtime listener below during transition
  const [localLaserPoint, setLocalLaserPoint] = useState(null); // {x,y} | null — presenter's own live dot

  // ---- Export menu — inline panel instead of Alert.alert (doesn't reliably work on web) ----
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // ---- Remote cursors / presence names (#14) -----------------------------------
  const [remoteCursors, setRemoteCursors] = useState({}); // userId -> {x,y,name,color}
  const cursorTimers = useRef({});
  const lastCursorSentAt = useRef(0);

  // ---- Text tool modal ----------------------------------------------------------
  const [textModal, setTextModal] = useState(null); // { x, y } | null
  const [textDraft, setTextDraft] = useState('');

  // ---- Canvas layout (measured, not assumed from window size) ---------------------
  // Using Dimensions.get('window') for the SVG viewBox is wrong in embedded mode:
  // the board's real container is whatever the flex layout gives it (e.g.
  // SessionMain's boardMainArea), which is almost never the same size as the
  // browser window. A mismatched viewBox makes content draw/clip against the
  // wrong coordinate space — showing up as blank regions and taps that land on
  // the canvas but resolve to the wrong point. We measure the actual box instead.
  const [canvasSize, setCanvasSize] = useState({ width: SCREEN_W, height: SCREEN_H });
  const onCanvasLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setCanvasSize({ width, height });
  };

  // ---- Measured chrome heights ---------------------------------------------------
  // The floating color palette and shapes/export menus used to be pinned at
  // hardcoded pixel offsets (`top: 90`, `bottom: 90`). That only happened to
  // line up when the header was exactly one row tall and the toolbar was
  // exactly one fixed size — as soon as the pages dropdown or the view-only
  // banner appeared, or the toolbar grew/shrank on a bigger/smaller screen,
  // the palette either overlapped the header or floated in empty space. We
  // measure the real heights instead so these panels always dock right
  // against the actual edge of the header/toolbar, on any screen.
  const [headerHeight, setHeaderHeight] = useState(0);
  const onHeaderLayout = (e) => setHeaderHeight(e.nativeEvent.layout.height);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const onToolbarLayout = (e) => setToolbarHeight(e.nativeEvent.layout.height);

  // ---- Infinite canvas: pan/zoom (#10) --------------------------------------------
  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const pinchRef = useRef(null);
  const panRef = useRef(null);
  const baseScale = useRef(1);
  const baseTranslate = useRef({ x: 0, y: 0 });

  // ---- Refs for the drawing gesture ------------------------------------------------
  const channelRef = useRef(null);
  const currentPointsRef = useRef([]); // raw [x,y] points being drawn
  const currentShapeRef = useRef(null); // {x1,y1,x2,y2} while dragging a shape
  const activeToolRef = useRef(activeTool);
  const activeColorRef = useRef(activeColor);
  const activeBrushRef = useRef(activeBrush);
  const lastOwnStrokeId = useRef(null);
  const redoStackRef = useRef([]); // this user's own undone strokes, for Redo
  const canvasRef = useRef(null); // wraps the Svg for PNG export

  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { activeColorRef.current = activeColor; }, [activeColor]);
  useEffect(() => { activeBrushRef.current = activeBrush; }, [activeBrush]);

  // ---------------------------------------------------------------------------
  // Load / create pages (#4)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!sessionId) return;
    loadPages();

    // Postgres realtime for new pages — without this, a client (typically a
    // called-up attendee) whose initial SELECT races ahead of the host's
    // INSERT ends up with pages=[] and activePageId=null *permanently*,
    // since only the host creates pages and nothing else ever retries.
    // That client's canvas never subscribes to the realtime stroke channel
    // below (it's gated on activePageId), so it silently never syncs with
    // everyone else even though nothing looks "broken" on screen.
    const pagesCh = supabase
      .channel(`board-pages-${sessionId}-${boardKind}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'board_pages', filter: `session_id=eq.${sessionId}` },
        ({ new: row }) => {
          if (row.board_type !== boardKind) return;
          setPages((prev) => (prev.some((p) => p.id === row.id) ? prev : [...prev, row].sort((a, b) => a.position - b.position)));
          setActivePageId((prev) => prev ?? row.id);
        }
      )
      .subscribe();

    return () => supabase.removeChannel(pagesCh);
  }, [sessionId, boardKind]);

  const loadPages = async () => {
    const { data, error } = await supabase
      .from('board_pages')
      .select('*')
      .eq('session_id', sessionId)
      .eq('board_type', boardKind)
      .order('position');

    if (error) {
      console.warn('loadPages error', error);
      return;
    }
    if (data && data.length) {
      setPages(data);
      setActivePageId((prev) => prev ?? data[0].id);
    } else if (isHost) {
      const { data: created, error: createErr } = await supabase
        .from('board_pages')
        .insert({ session_id: sessionId, board_type: boardKind, name: 'Board 1', position: 0 })
        .select()
        .single();
      if (!createErr && created) {
        setPages([created]);
        setActivePageId(created.id);
      }
    }
  };

  const addPage = async () => {
    if (!isHost) return; // only the host manages pages, mirrors the lock/permission model
    const position = pages.length;
    const { data, error } = await supabase
      .from('board_pages')
      .insert({ session_id: sessionId, board_type: boardKind, name: `Board ${position + 1}`, position })
      .select()
      .single();
    if (!error && data) {
      setPages((prev) => [...prev, data]);
      setActivePageId(data.id);
    }
  };

  // ---------------------------------------------------------------------------
  // Load strokes for the active page + persistence (#2)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!activePageId) return;
    loadStrokes(activePageId);
    setSelectedId(null);
  }, [activePageId]);

  const loadStrokes = async (pageId) => {
    const { data, error } = await supabase
      .from('board_strokes')
      .select('*')
      .eq('page_id', pageId)
      .order('created_at');
    if (error) {
      console.warn('loadStrokes error', error);
      return;
    }
    setStrokes((data || []).map((row) => row.data));
  };

  const persistStroke = async (stroke) => {
    if (!sessionId || !activePageId) return;
    const { error } = await supabase.from('board_strokes').upsert({
      id: stroke.id,
      session_id: sessionId,
      page_id: activePageId,
      board_type: boardKind,
      type: stroke.type,
      data: stroke,
      created_by: userId,
    });
    if (error) console.warn('persistStroke error', error);
  };

  const deleteStrokeRemote = async (id) => {
    const { error } = await supabase.from('board_strokes').delete().eq('id', id);
    if (error) console.warn('deleteStroke error', error);
  };

  const clearBoardRemote = async () => {
    if (!activePageId) return;
    await supabase.from('board_strokes').delete().eq('page_id', activePageId);
  };

  // ---------------------------------------------------------------------------
  // Realtime channel (per page, so switching pages re-subscribes) (#3, #6, #8, #13, #14)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!sessionId || !activePageId) return;

    const channel = supabase
      .channel(`whiteboard-${sessionId}-${activePageId}`)
      .on('broadcast', { event: 'stroke' }, ({ payload }) => {
        setStrokes((prev) => [...prev, payload.stroke]);
      })
      .on('broadcast', { event: 'delete_stroke' }, ({ payload }) => {
        setStrokes((prev) => prev.filter((s) => s.id !== payload.id));
      })
      .on('broadcast', { event: 'clear' }, () => setStrokes([]))
      .on('broadcast', { event: 'lock' }, ({ payload }) => setBoardLocked(!!payload.locked))
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        if (payload.userId === userId) return;
        setRemoteCursors((prev) => ({ ...prev, [payload.userId]: payload }));
        clearTimeout(cursorTimers.current[payload.userId]);
        cursorTimers.current[payload.userId] = setTimeout(() => {
          setRemoteCursors((prev) => {
            const next = { ...prev };
            delete next[payload.userId];
            return next;
          });
        }, CURSOR_IDLE_MS);
      })
      .subscribe();

    channelRef.current = channel;
    return () => supabase.removeChannel(channel);
  }, [sessionId, activePageId, userId]);

  const broadcast = (event, payload = {}) => {
    channelRef.current?.send({ type: 'broadcast', event, payload });
  };

  // ---------------------------------------------------------------------------
  // Drawing gesture (pen / highlighter / eraser / shapes / text / laser / select)
  // ---------------------------------------------------------------------------
  const toCanvasPoint = (screenX, screenY) => {
    // Adjust for pan/zoom so strokes land in the right place regardless of view state (#10)
    const { scale, tx, ty } = transform;
    return [(screenX - tx) / scale, (screenY - ty) / scale];
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Only claim the gesture for single-finger touches — two fingers are
        // reserved for the pinch/pan (infinite canvas) handlers below.
        onStartShouldSetPanResponder: (e) => effectiveCanDraw && e.nativeEvent.touches.length === 1,
        onMoveShouldSetPanResponder: (e) => effectiveCanDraw && e.nativeEvent.touches.length === 1,

        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          const [x, y] = toCanvasPoint(locationX, locationY);
          const tool = activeToolRef.current;

          if (tool === 'select') {
            const hit = [...strokes].reverse().find((s) => strokeHitAtPoint(s, [x, y]));
            setSelectedId(hit?.id ?? null);
            return;
          }

          if (tool === 'eraser') {
            eraseAt([x, y]);
            return;
          }

          if (SHAPE_TOOLS.includes(tool)) {
            currentShapeRef.current = { x1: x, y1: y, x2: x, y2: y };
            return;
          }

          // pen / highlighter — laser handled separately below, no path accumulation
          if (tool === 'laser') return;
          currentPointsRef.current = [[x, y]];
          setCurrentPath(`M${x.toFixed(1)},${y.toFixed(1)}`);
        },

        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          const [x, y] = toCanvasPoint(locationX, locationY);
          const tool = activeToolRef.current;

          sendCursorThrottled(x, y, tool);

          if (tool === 'select') return;

          if (tool === 'eraser') {
            eraseAt([x, y]);
            return;
          }

          if (SHAPE_TOOLS.includes(tool)) {
            if (currentShapeRef.current) {
              currentShapeRef.current.x2 = x;
              currentShapeRef.current.y2 = y;
            }
            // force a re-render for the live shape preview
            setStrokes((prev) => [...prev]);
            return;
          }

          if (tool === 'laser') {
            setLocalLaserPoint([x, y]);
            return;
          }

          currentPointsRef.current.push([x, y]);
          setCurrentPath((prev) => `${prev} L${x.toFixed(1)},${y.toFixed(1)}`);
        },

        onPanResponderRelease: (e) => {
          const tool = activeToolRef.current;

          if (tool === 'select' || tool === 'eraser') return;

          if (SHAPE_TOOLS.includes(tool)) {
            const shape = currentShapeRef.current;
            currentShapeRef.current = null;
            if (!shape) return;
            const moved = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) > 4;

            if (tool === 'text') {
              // A tap (not a drag) with the text tool opens the text entry modal (#5)
              setTextModal({ x: shape.x1, y: shape.y1 });
              return;
            }
            if (!moved) return; // ignore accidental taps for shapes

            finalizeShapeStroke(tool, shape);
            return;
          }

          // pen / highlighter / laser
          if (tool === 'laser') {
            currentPointsRef.current = [];
            setLocalLaserPoint(null);
            return;
          }

          const points = currentPointsRef.current;
          currentPointsRef.current = [];
          setCurrentPath('');
          if (points.length < 2) return;

          const isHighlighter = tool === 'highlighter';
          const size = isHighlighter ? activeBrushRef.current * 2.5 : activeBrushRef.current;
          const d = smoothStroke(points, size);
          const stroke = {
            id: uuidv4(),
            type: 'freehand',
            d,
            points,
            color: activeColorRef.current,
            width: size,
            opacity: isHighlighter ? 0.35 : 1,
            authorId: userId,
            authorName: userName,
          };
          commitStroke(stroke);
        },
      }),
    [strokes, effectiveCanDraw, transform]
  );

  const finalizeShapeStroke = (tool, shape) => {
    const stroke = {
      id: uuidv4(),
      type: tool,
      ...shape,
      color: activeColorRef.current,
      width: activeBrushRef.current,
      authorId: userId,
      authorName: userName,
    };
    commitStroke(stroke);
  };

  const commitStroke = (stroke) => {
    setStrokes((prev) => [...prev, stroke]);
    lastOwnStrokeId.current = stroke.id;
    redoStackRef.current = [];
    broadcast('stroke', { stroke });
    persistStroke(stroke);
  };

  const eraseAt = (point) => {
    const hit = strokes.find((s) => strokeHitAtPoint(s, point));
    if (!hit) return;
    removeStroke(hit.id);
  };

  const removeStroke = (id) => {
    setStrokes((prev) => prev.filter((s) => s.id !== id));
    broadcast('delete_stroke', { id });
    deleteStrokeRemote(id);
    if (selectedId === id) setSelectedId(null);
  };

  // ---------------------------------------------------------------------------
  // Cursor broadcasting (#14)
  // ---------------------------------------------------------------------------
  const sendCursorThrottled = (x, y, tool) => {
    const now = Date.now();
    if (now - lastCursorSentAt.current < CURSOR_THROTTLE_MS) return;
    lastCursorSentAt.current = now;
    broadcast('cursor', { userId, name: userName, x, y, tool, color: activeColorRef.current });
  };

  // ---------------------------------------------------------------------------
  // Undo / redo — by stroke ID, not "whatever's last" (#3, #8)
  // ---------------------------------------------------------------------------
  const undo = () => {
    const id = lastOwnStrokeId.current;
    if (!id) return;
    const stroke = strokes.find((s) => s.id === id);
    if (stroke) redoStackRef.current.push(stroke);
    removeStroke(id);
    lastOwnStrokeId.current = null;
  };

  const redo = () => {
    const stroke = redoStackRef.current.pop();
    if (!stroke) return;
    commitStroke(stroke);
  };

  const clearBoard = () => {
    const doClear = () => {
      setStrokes([]);
      broadcast('clear');
      clearBoardRemote();
    };
    const msg = 'Clear board? This removes every stroke on this page for everyone.';
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) doClear();
      return;
    }
    Alert.alert(
      'Clear board?',
      'This removes every stroke on this page for everyone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: doClear },
      ]
    );
  };

  // ---------------------------------------------------------------------------
  // Lock board (#13) — host only
  // ---------------------------------------------------------------------------
  const toggleLock = () => {
    if (!isHost) return;
    const next = !boardLocked;
    setBoardLocked(next);
    broadcast('lock', { locked: next });
  };

  // ---------------------------------------------------------------------------
  // Text tool submit
  // ---------------------------------------------------------------------------
  const submitText = () => {
    if (textModal && textDraft.trim()) {
      commitStroke({
        id: uuidv4(),
        type: 'text',
        x1: textModal.x,
        y1: textModal.y,
        x2: textModal.x,
        y2: textModal.y,
        text: textDraft.trim(),
        color: activeColorRef.current,
        width: activeBrushRef.current,
        authorId: userId,
        authorName: userName,
      });
    }
    setTextModal(null);
    setTextDraft('');
    // Without this, activeTool stays 'text' — the very next tap/drag anywhere
    // on the canvas (even an accidental one) silently reopens this modal,
    // which visually looks like "random taps stop doing anything" since the
    // modal backdrop swallows touches until you notice it's there.
    setActiveTool('pen');
  };

  const cancelTextModal = () => {
    setTextModal(null);
    setTextDraft('');
    setActiveTool('pen');
  };

  // ---------------------------------------------------------------------------
  // Export (#9) — PNG via view-shot, SVG built by hand.
  // PDF isn't included: it needs a native module (expo-print or
  // react-native-html-to-pdf) that isn't in this file's dependency list yet.
  // Wire one up and call it here the same way exportPng/exportSvg work.
  // ---------------------------------------------------------------------------
  const exportPng = async () => {
    try {
      const uri = await captureRef(canvasRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        window.alert(`Saved: ${uri}`);
      }
    } catch (err) {
      console.warn('exportPng error', err);
      window.alert('Export failed: could not export the board as PNG.');
    }
    setExportMenuOpen(false);
  };

  const exportSvg = async () => {
    try {
      const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasSize.width}" height="${canvasSize.height}" viewBox="0 0 ${canvasSize.width} ${canvasSize.height}"><rect width="100%" height="100%" fill="${T.canvasBg}"/>${strokes
        .map(strokeToSvgMarkup)
        .join('')}</svg>`;
      const uri = FileSystem.documentDirectory + `board-${Date.now()}.svg`;
      await FileSystem.writeAsStringAsync(uri, markup);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        window.alert(`Saved: ${uri}`);
      }
    } catch (err) {
      console.warn('exportSvg error', err);
      window.alert('Export failed: could not export the board as SVG.');
    }
    setExportMenuOpen(false);
  };

  const openExportMenu = () => setExportMenuOpen((v) => !v);

  // ---------------------------------------------------------------------------
  // Pan / zoom gesture handlers (#10)
  // Two-finger only, so one finger is always free to draw/select/erase.
  // ---------------------------------------------------------------------------
  const onPinchEvent = (e) => {
    const scale = Math.max(0.4, Math.min(4, baseScale.current * e.nativeEvent.scale));
    setTransform((t) => ({ ...t, scale }));
  };
  const onPinchStateChange = (e) => {
    if (e.nativeEvent.oldState === GestureState.ACTIVE) baseScale.current = transform.scale;
  };
  const onPanEvent = (e) => {
    setTransform((t) => ({
      ...t,
      tx: baseTranslate.current.x + e.nativeEvent.translationX,
      ty: baseTranslate.current.y + e.nativeEvent.translationY,
    }));
  };
  const onPanStateChange = (e) => {
    if (e.nativeEvent.oldState === GestureState.ACTIVE) {
      baseTranslate.current = { x: transform.tx, y: transform.ty };
    }
  };
  const resetView = () => {
    setTransform({ scale: 1, tx: 0, ty: 0 });
    baseScale.current = 1;
    baseTranslate.current = { x: 0, y: 0 };
  };

  if (!visible) return null;

  const activePage = pages.find((p) => p.id === activePageId);
  const containerStyle = mode === 'embedded' ? styles.embeddedContainer : styles.fullscreenContainer;

  const iconBtnSize = scale(30);
  const headerIconSize = Math.max(15, scale(15));

  return (
    <View style={[containerStyle, { backgroundColor: T.containerBg }]}>
      {/* Header stack — top bar + optional pages dropdown + optional
          view-only banner, measured as one block so floating panels below
          (color palette, shapes menu) can dock against its real bottom
          edge instead of a hardcoded guess. */}
      <View onLayout={onHeaderLayout}>
        <View style={[styles.topBar, { backgroundColor: T.topBarBg, borderBottomColor: T.topBarBorder }]}>
          <TouchableOpacity
            onPress={onRequestClose}
            style={[styles.iconBtn, { width: iconBtnSize, height: iconBtnSize, borderRadius: iconBtnSize / 2, backgroundColor: T.toolBg }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ToolIcon name={mode === 'embedded' ? 'minimize' : 'back'} size={headerIconSize} color={T.accent} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.titleBtn} onPress={() => setPagesMenuOpen((v) => !v)}>
            <Text style={[styles.title, { color: T.textColor }]} numberOfLines={1}>{activePage?.name ?? T.label}</Text>
            <ToolIcon name="chevronDown" size={14} color={T.subtleText} />
          </TouchableOpacity>

          <View style={styles.topBarRight}>
            {boardLocked && (
              <View style={styles.lockBadge}>
                <ToolIcon name="lockClosed" size={11} color={colors.red} />
                <Text style={styles.lockBadgeText}>Locked</Text>
              </View>
            )}
            {isHost && (
              <TouchableOpacity onPress={toggleLock} style={[styles.lockToggle, { backgroundColor: T.toolBg, borderColor: T.toolBorder }]}>
                <ToolIcon name={boardLocked ? 'lockOpen' : 'lockClosed'} size={12} color={T.textColor} />
                <Text style={[styles.lockToggleText, { color: T.textColor }]}>{boardLocked ? 'Unlock' : 'Lock'}</Text>
              </TouchableOpacity>
            )}
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          </View>
        </View>

        {/* Pages dropdown (#4) */}
        {pagesMenuOpen && (
          <View style={[styles.pagesMenu, { backgroundColor: T.panelBg, borderBottomColor: T.topBarBorder }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pagesMenuContent}>
              {pages.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.pageChip, { backgroundColor: T.toolBg, borderColor: T.toolBorder }, p.id === activePageId && { backgroundColor: T.accent, borderColor: T.accent }]}
                  onPress={() => {
                    setActivePageId(p.id);
                    setPagesMenuOpen(false);
                  }}
                >
                  <Text style={[styles.pageChipText, { color: p.id === activePageId ? '#fff' : T.textColor }]}>{p.name}</Text>
                </TouchableOpacity>
              ))}
              {isHost && (
                <TouchableOpacity style={[styles.addPageChip, { borderColor: T.accent }]} onPress={addPage}>
                  <ToolIcon name="add" size={14} color={T.accent} />
                  <Text style={[styles.addPageChipText, { color: T.accent }]}>Add board</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        )}

        {!effectiveCanDraw && (
          <View style={styles.viewOnlyBanner}>
            <Text style={styles.viewOnlyText}>
              {isHost
                ? "You're in view-only mode — tap Interrupt to take over"
                : boardLocked
                ? 'Board is locked by the host'
                : "You're in view-only mode"}
            </Text>
          </View>
        )}
      </View>

      {/* Canvas, wrapped for pinch/pan (#10) and export capture (#9) */}
      <PinchGestureHandler
        ref={pinchRef}
        simultaneousHandlers={panRef}
        onGestureEvent={onPinchEvent}
        onHandlerStateChange={onPinchStateChange}
        minPointers={2}
      >
        <PanGestureHandler
          ref={panRef}
          simultaneousHandlers={pinchRef}
          onGestureEvent={onPanEvent}
          onHandlerStateChange={onPanStateChange}
          minPointers={2}
          maxPointers={2}
        >
          <View
            style={[styles.canvas, { backgroundColor: T.canvasBg }]}
            {...panResponder.panHandlers}
            ref={canvasRef}
            onLayout={onCanvasLayout}
          >
            <Svg
              style={StyleSheet.absoluteFill}
              viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
            >
              <G transform={`translate(${transform.tx}, ${transform.ty}) scale(${transform.scale})`}>
                {strokes.map((s) => (
                  <StrokeShape key={s.id} stroke={s} selected={s.id === selectedId} />
                ))}
                {currentShapeRef.current && SHAPE_TOOLS.includes(activeTool) && activeTool !== 'text' && (
                  <StrokeShape
                    stroke={{
                      id: '__live',
                      type: activeTool,
                      ...currentShapeRef.current,
                      color: activeColor,
                      width: activeBrush,
                    }}
                  />
                )}
                {currentPath ? (
                  <Path
                    d={currentPath}
                    stroke={activeTool === 'eraser' ? 'transparent' : activeColor}
                    strokeOpacity={activeTool === 'highlighter' ? 0.35 : 1}
                    strokeWidth={activeTool === 'highlighter' ? activeBrush * 2.5 : activeBrush}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null}
                {laserPath && <Path d={laserPath.d} fill={laserPath.color} opacity={0.85} />}
                {localLaserPoint && (
                  <Circle cx={localLaserPoint[0]} cy={localLaserPoint[1]} r={8} fill={activeColor} opacity={0.85} />
                )}
                {Object.entries(remoteCursors).map(([id, c]) => (
                  <RemoteCursor key={id} cursor={c} />
                ))}
              </G>
            </Svg>
          </View>
        </PanGestureHandler>
      </PinchGestureHandler>

      {/* Floating color palette — docked against the real bottom edge of
          the measured header, and clamped so it can never run off the
          right edge of a narrow screen (the old fixed `right: 12` and
          `top: 90` combo is what used to leave it misaligned). */}
      {colorMenuOpen && (
        <View style={[styles.colorPalette, { top: headerHeight + 10, backgroundColor: T.panelBg, borderColor: T.panelBorder }]}>
          <View style={styles.colorPaletteHeader}>
            <Text style={[styles.colorPaletteTitle, { color: T.subtleText }]}>Color & size</Text>
            <TouchableOpacity onPress={() => setColorMenuOpen(false)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <ToolIcon name="close" size={15} color={T.subtleText} />
            </TouchableOpacity>
          </View>
          <View style={styles.colorSwatchGrid}>
            {T.palette.map((c) => (
              <TouchableOpacity
                key={c}
                style={[
                  styles.colorSwatch,
                  { width: scale(26), height: scale(26), borderRadius: scale(13), backgroundColor: c, borderColor: T.swatchBorder },
                  activeColor === c && [styles.colorSwatchActive, { borderColor: T.accent }],
                ]}
                onPress={() => setActiveColor(c)}
              />
            ))}
          </View>
          <View style={[styles.paletteDivider, { backgroundColor: T.panelBorder }]} />
          <View style={styles.brushRow}>
            {brushSizes.map((size) => (
              <TouchableOpacity
                key={size}
                style={[styles.brushBtn, { backgroundColor: T.toolBg }, activeBrush === size && { backgroundColor: T.accentSoft, borderColor: T.accent, borderWidth: 1.5 }]}
                onPress={() => setActiveBrush(size)}
              >
                <View
                  style={{ width: size * 1.6, height: size * 1.6, borderRadius: size, backgroundColor: activeBrush === size ? T.accent : T.subtleText }}
                />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Shapes submenu (#5) — docked above the measured toolbar height */}
      {shapesMenuOpen && (
        <View style={[styles.shapesMenu, { bottom: toolbarHeight + 12, backgroundColor: T.panelBg, borderColor: T.panelBorder }]}>
          {[
            ['rect', 'Rect'],
            ['circle', 'Circle'],
            ['line', 'Line'],
            ['arrow', 'Arrow'],
            ['text', 'Text'],
          ].map(([tool, label]) => (
            <TouchableOpacity
              key={tool}
              style={[
                styles.toolBtn,
                { width: scale(58), height: scale(58), backgroundColor: T.toolBg, borderColor: T.toolBorder },
                activeTool === tool && { backgroundColor: T.accent, borderColor: T.accent },
              ]}
              onPress={() => {
                setActiveTool(tool);
                setShapesMenuOpen(false);
              }}
            >
              <ToolIcon name={tool} size={scale(18)} color={activeTool === tool ? T.toolIconColorActive : T.toolIconColor} />
              <Text style={[styles.toolLabel, { color: activeTool === tool ? T.toolLabelColorActive : T.toolLabelColor }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Export menu (replaces Alert.alert chooser — unreliable on web) */}
      {exportMenuOpen && (
        <View style={[styles.shapesMenu, { bottom: toolbarHeight + 12, backgroundColor: T.panelBg, borderColor: T.panelBorder }]}>
          <TouchableOpacity
            style={[styles.toolBtn, { width: scale(72), height: scale(58), backgroundColor: T.toolBg, borderColor: T.toolBorder }]}
            onPress={exportPng}
          >
            <ToolIcon name="image" size={scale(18)} color={T.toolIconColor} />
            <Text style={[styles.toolLabel, { color: T.toolLabelColor }]}>Save PNG</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toolBtn, { width: scale(72), height: scale(58), backgroundColor: T.toolBg, borderColor: T.toolBorder }]}
            onPress={exportSvg}
          >
            <ToolIcon name="document" size={scale(18)} color={T.toolIconColor} />
            <Text style={[styles.toolLabel, { color: T.toolLabelColor }]}>Save SVG</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Selection actions (#7) */}
      {selectedId && (
        <View style={[styles.selectionBar, { bottom: toolbarHeight + 12 }]}>
          <Text style={styles.selectionText}>1 object selected</Text>
          <TouchableOpacity style={styles.selectionAction} onPress={() => removeStroke(selectedId)}>
            <ToolIcon name="clear" size={14} color="#FF8A8A" />
            <Text style={styles.selectionDelete}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.selectionAction} onPress={() => setSelectedId(null)}>
            <Text style={styles.selectionCancel}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom toolbar (#16 layout) */}
      {effectiveCanDraw && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.bottomToolbar, { backgroundColor: T.toolbarBg, borderTopColor: T.toolbarBorder }]}
          contentContainerStyle={styles.bottomToolbarContent}
          onLayout={onToolbarLayout}
        >
          <ToolButton T={T} scale={scale} iconName="pen" label={T.penToolLabel} active={activeTool === 'pen'} onPress={() => { setActiveTool('pen'); setShapesMenuOpen(false); setColorMenuOpen(true); }} />
          <ToolButton T={T} scale={scale} iconName="highlighter" label="Highlight" active={activeTool === 'highlighter'} onPress={() => { setActiveTool('highlighter'); setShapesMenuOpen(false); }} />
          <ToolButton T={T} scale={scale} iconName="eraser" label="Eraser" active={activeTool === 'eraser'} onPress={() => { setActiveTool('eraser'); setShapesMenuOpen(false); setColorMenuOpen(false); }} />
          <ToolButton T={T} scale={scale} iconName="shapes" label="Shapes" active={SHAPE_TOOLS.includes(activeTool)} onPress={() => setShapesMenuOpen((v) => !v)} />
          <ToolButton T={T} scale={scale} iconName="laser" label="Laser" active={activeTool === 'laser'} onPress={() => { setActiveTool('laser'); setShapesMenuOpen(false); }} />
          <ToolButton T={T} scale={scale} iconName="select" label="Select" active={activeTool === 'select'} onPress={() => { setActiveTool('select'); setShapesMenuOpen(false); }} />
          <View style={[styles.divider, { backgroundColor: T.toolbarBorder }]} />
          <ToolButton T={T} scale={scale} iconName="undo" label="Undo" onPress={undo} />
          <ToolButton T={T} scale={scale} iconName="redo" label="Redo" onPress={redo} />
          <ToolButton T={T} scale={scale} iconName="clear" label="Clear" danger onPress={clearBoard} />
          <View style={[styles.divider, { backgroundColor: T.toolbarBorder }]} />
          <ToolButton T={T} scale={scale} iconName="save" label="Save" onPress={openExportMenu} />
          <ToolButton T={T} scale={scale} iconName="resetView" label="Reset view" onPress={resetView} />
        </ScrollView>
      )}

      {/* Text entry modal (#5) */}
      <Modal visible={!!textModal} transparent animationType="fade" onRequestClose={cancelTextModal}>
        <View style={styles.textModalBackdrop}>
          <View style={styles.textModalBox}>
            <Text style={styles.textModalLabel}>Add text</Text>
            <TextInput
              autoFocus
              value={textDraft}
              onChangeText={setTextDraft}
              style={styles.textModalInput}
              placeholder="Type something…"
            />
            <View style={styles.textModalRow}>
              <TouchableOpacity onPress={cancelTextModal}>
                <Text style={styles.textModalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitText}>
                <Text style={styles.textModalConfirm}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ToolButton({ iconName, label, active, danger, onPress, T, scale = (n) => n }) {
  const theme = T || THEMES.whiteboard;
  const size = scale(56);
  const iconColor = danger ? colors.red : active ? theme.toolIconColorActive : theme.toolIconColor;
  const labelColor = danger ? colors.red : active ? theme.toolLabelColorActive : theme.toolLabelColor;
  return (
    <TouchableOpacity
      style={[
        styles.toolBtn,
        { width: size, height: size, backgroundColor: theme.toolBg, borderColor: theme.toolBorder },
        active && { backgroundColor: theme.accent, borderColor: theme.accent },
        danger && styles.toolBtnDanger,
      ]}
      onPress={onPress}
      hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
    >
      <ToolIcon name={iconName} size={scale(18)} color={iconColor} />
      <Text style={[styles.toolLabel, { color: labelColor }]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function StrokeShape({ stroke, selected }) {
  const stroked = selected ? { stroke: colors.primary, strokeWidth: 2, strokeDasharray: '4,3' } : {};
  switch (stroke.type) {
    case 'freehand':
      return <Path d={stroke.d} fill={stroke.color} opacity={stroke.opacity ?? 1} {...stroked} />;
    case 'rect': {
      const x = Math.min(stroke.x1, stroke.x2), y = Math.min(stroke.y1, stroke.y2);
      const w = Math.abs(stroke.x2 - stroke.x1), h = Math.abs(stroke.y2 - stroke.y1);
      return <Rect x={x} y={y} width={w} height={h} stroke={selected ? colors.primary : stroke.color} strokeWidth={stroke.width} fill="none" />;
    }
    case 'circle': {
      const cx = (stroke.x1 + stroke.x2) / 2, cy = (stroke.y1 + stroke.y2) / 2;
      const r = Math.hypot(stroke.x2 - stroke.x1, stroke.y2 - stroke.y1) / 2;
      return <Circle cx={cx} cy={cy} r={r} stroke={selected ? colors.primary : stroke.color} strokeWidth={stroke.width} fill="none" />;
    }
    case 'line':
      return <Line x1={stroke.x1} y1={stroke.y1} x2={stroke.x2} y2={stroke.y2} stroke={selected ? colors.primary : stroke.color} strokeWidth={stroke.width} strokeLinecap="round" />;
    case 'arrow':
      return <ArrowShape stroke={stroke} selected={selected} />;
    case 'text':
      return (
        <SvgText x={stroke.x1} y={stroke.y1} fill={selected ? colors.primary : stroke.color} fontSize={(stroke.width || 4) * 6}>
          {stroke.text}
        </SvgText>
      );
    default:
      return null;
  }
}

function ArrowShape({ stroke, selected }) {
  const { x1, y1, x2, y2, width, color } = stroke;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = Math.max(10, width * 3);
  const p1x = x2 - headLen * Math.cos(angle - Math.PI / 6);
  const p1y = y2 - headLen * Math.sin(angle - Math.PI / 6);
  const p2x = x2 - headLen * Math.cos(angle + Math.PI / 6);
  const p2y = y2 - headLen * Math.sin(angle + Math.PI / 6);
  const c = selected ? colors.primary : color;
  return (
    <>
      <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={width} strokeLinecap="round" />
      <Line x1={x2} y1={y2} x2={p1x} y2={p1y} stroke={c} strokeWidth={width} strokeLinecap="round" />
      <Line x1={x2} y1={y2} x2={p2x} y2={p2y} stroke={c} strokeWidth={width} strokeLinecap="round" />
    </>
  );
}

function RemoteCursor({ cursor }) {
  if (cursor.tool === 'laser') {
    // Bigger dot, no name label — this IS the laser pointer, meant to be glanced at, not read
    return <Circle cx={cursor.x} cy={cursor.y} r={9} fill={cursor.color || colors.primary} opacity={0.85} />;
  }
  return (
    <>
      <Circle cx={cursor.x} cy={cursor.y} r={5} fill={cursor.color || colors.primary} />
      <SvgText x={cursor.x + 8} y={cursor.y - 8} fontSize={11} fill={cursor.color || colors.primary}>
        {cursor.name}
      </SvgText>
    </>
  );
}

const styles = StyleSheet.create({
  fullscreenContainer: { flex: 1, backgroundColor: colors.white },
  embeddedContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.white,
    zIndex: 50,
    elevation: 50,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 40,
    gap: 10,
    borderBottomWidth: 1,
  },
  iconBtn: { alignItems: 'center', justifyContent: 'center' },
  titleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  title: { fontSize: 16, fontWeight: '700', maxWidth: 180 },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lockBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFE8E8', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
  },
  lockBadgeText: { fontSize: 11, color: colors.red, fontWeight: '700' },
  lockToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
  },
  lockToggleText: { fontSize: 11, fontWeight: '700' },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFE8E8', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red },
  liveText: { color: colors.red, fontSize: 11, fontWeight: '700' },

  pagesMenu: { paddingVertical: 8, borderBottomWidth: 1 },
  pagesMenuContent: { paddingHorizontal: 12, alignItems: 'center' },
  pageChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, borderWidth: 1, marginRight: 8 },
  pageChipText: { fontSize: 12, fontWeight: '600' },
  addPageChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, marginRight: 8,
  },
  addPageChipText: { fontSize: 12, fontWeight: '600' },

  viewOnlyBanner: { backgroundColor: '#FFF6E5', paddingVertical: 6, alignItems: 'center' },
  viewOnlyText: { fontSize: 12, color: '#8A6D00', fontWeight: '600' },

  canvas: { flex: 1, position: 'relative' },

  // ── Floating color palette ──
  // Positioned via inline `top` (measured header height) rather than a
  // fixed offset — see onHeaderLayout. Only right/borders/shadow are
  // fixed here.
  colorPalette: {
    position: 'absolute', right: 12, maxWidth: 220,
    padding: 10, borderRadius: 14, borderWidth: 1,
    elevation: 6, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    zIndex: 60,
  },
  colorPaletteHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  colorPaletteTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  colorSwatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, maxWidth: 160 },
  colorSwatch: { borderWidth: 2 },
  colorSwatchActive: { borderWidth: 3, transform: [{ scale: 1.12 }] },
  paletteDivider: { height: 1, marginVertical: 10 },
  brushRow: { flexDirection: 'row', gap: 6, justifyContent: 'space-between' },
  brushBtn: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  // ── Shapes / export submenu ──
  shapesMenu: {
    position: 'absolute', left: 12, flexDirection: 'row', gap: 6,
    padding: 8, borderRadius: 14, borderWidth: 1,
    elevation: 6, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    zIndex: 60,
  },

  // ── Selection bar ──
  selectionBar: {
    position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.text, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22,
    elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    zIndex: 60,
  },
  selectionText: { color: colors.white, fontSize: 12 },
  selectionAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  selectionDelete: { color: '#FF8A8A', fontSize: 12, fontWeight: '700' },
  selectionCancel: { color: colors.white, fontSize: 12, fontWeight: '700' },

  // ── Bottom toolbar ──
  bottomToolbar: { borderTopWidth: 1 },
  bottomToolbarContent: { paddingHorizontal: 12, paddingVertical: 10, alignItems: 'center', gap: 8 },
  toolBtn: { alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, gap: 3 },
  toolBtnDanger: { backgroundColor: '#FFE8E8', borderColor: '#FFD3D3' },
  toolLabel: { fontSize: 9, fontWeight: '600', maxWidth: 60 },
  divider: { width: 1, height: 36, marginHorizontal: 2 },

  // ── Text tool modal ──
  textModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  textModalBox: { width: '80%', backgroundColor: colors.white, borderRadius: 14, padding: 16 },
  textModalLabel: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 8 },
  textModalInput: { borderWidth: 1, borderColor: colors.greyLight, borderRadius: 8, padding: 10, fontSize: 14 },
  textModalRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20, marginTop: 12 },
  textModalCancel: { color: colors.text, fontWeight: '600' },
  textModalConfirm: { color: colors.primary, fontWeight: '700' },
});

/* ---------------------------------------------------------------------------
 * Backward-compatible screen wrapper, if you still navigate to a standalone
 * whiteboard anywhere (e.g. from a menu outside of an active session).
 *
 * export function WhiteboardScreen({ navigation, route }) {
 *   const { session, isHost, currentUser } = route.params || {};
 *   return (
 *     <WhiteboardCanvas
 *       session={session}
 *       currentUser={currentUser}
 *       isHost={isHost}
 *       canDraw={true}
 *       visible={true}
 *       mode="fullscreen"
 *       onRequestClose={() => navigation.goBack()}
 *     />
 *   );
 * }
 * ------------------------------------------------------------------------- */