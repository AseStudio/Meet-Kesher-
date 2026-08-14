import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, Dimensions
} from 'react-native';
import Svg, { Path, Rect, Circle, Line, Text as SvgText, G } from 'react-native-svg';
import { colors } from '../theme/colors';
import { supabase } from '../lib/supabase';

/**
 * GraphBoardCanvas
 * -----------------
 * Same treatment as WhiteboardCanvas (#17, "the biggest recommendation"):
 * this used to be a screen (`navigation`/`route`), which meant tapping
 * "Graph Board" left SessionMain entirely — video, chat, everything gone.
 * Now it's a plain component you render inline, same as WhiteboardCanvas.
 *
 *   <GraphBoardCanvas
 *     session={session}
 *     currentUser={currentUser}
 *     isHost={isHost}
 *     canEdit={hostOrAttendeeEditPermission} // the caller decides who can edit right
 *                                             // now — including the host. False while
 *                                             // someone else is called to the board,
 *                                             // true while the host is "interrupting"
 *     visible={boardVisible}
 *     mode="embedded"
 *     onRequestClose={() => setBoardVisible(false)}
 *   />
 *
 * Also fixes upgrade #2 ("save board history") for this board type: the
 * original never persisted a chart, so a late joiner saw a blank panel
 * until the next plot. Now the last plotted chart is saved to
 * `graph_boards` and loaded on mount.
 */

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Fallback only, used before the container's real width has been measured
// on first layout. The actual chart width now comes from `chartWidth`
// state below — using a module-level window-width constant here was the
// bug: in embedded mode the board gets whatever the flex layout gives it
// (SessionMain's boardMainArea, or AttendeeSession's boardViewFull), which
// is almost never the same as the full browser window, so the chart was
// built wider than its actual container and got clipped/overflowed.
const DEFAULT_CHART_W = SCREEN_WIDTH - 40;
const CHART_H = 260;
const PADDING = 50;

const chartTypes = [
  { id: 'line', label: 'Line', emoji: '📈' },
  { id: 'bar', label: 'Bar', emoji: '📊' },
  { id: 'scatter', label: 'Scatter', emoji: '🔵' },
];

const inputModes = [
  { id: 'equation', label: 'Equation', emoji: '📐' },
  { id: 'xytable', label: 'X/Y Table', emoji: '📋' },
  { id: 'data', label: 'Data Set', emoji: '📊' },
];

// Safe equation evaluator
const evalEquation = (expr, x) => {
  try {
    const safe = expr
      .replace(/\^/g, '**')
      .replace(/sin/g, 'Math.sin')
      .replace(/cos/g, 'Math.cos')
      .replace(/tan/g, 'Math.tan')
      .replace(/sqrt/g, 'Math.sqrt')
      .replace(/abs/g, 'Math.abs')
      .replace(/pi/g, 'Math.PI')
      .replace(/e\b/g, 'Math.E')
      .replace(/x/g, `(${x})`);
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${safe})`)();
  } catch {
    return null;
  }
};

export default function GraphBoardCanvas({
  session,
  currentUser,
  isHost = false,
  canEdit = true,
  visible = true,
  mode = 'fullscreen', // 'fullscreen' | 'embedded'
  onRequestClose,
}) {
  const sessionId = session?.id;
  // The caller now fully controls edit permission, including for the host —
  // this used to be `isHost || canEdit`, which meant the host could never be
  // put in view-only mode. That's no longer true: when the host has called
  // someone else up to the board, SessionMain passes canEdit={false} for the
  // host until they explicitly "Interrupt".
  const effectiveCanEdit = canEdit;

  const [inputMode, setInputMode] = useState('equation');
  const [chartType, setChartType] = useState('line');
  const [equation, setEquation] = useState('x^2');
  const [xMin, setXMin] = useState('-5');
  const [xMax, setXMax] = useState('5');
  const [xLabel, setXLabel] = useState('x');
  const [yLabel, setYLabel] = useState('y');
  const [xyRows, setXyRows] = useState([
    { x: '1', y: '2' },
    { x: '2', y: '5' },
    { x: '3', y: '3' },
    { x: '4', y: '8' },
    { x: '5', y: '6' },
  ]);
  const [dataRows, setDataRows] = useState([
    { label: 'Jan', value: '65' },
    { label: 'Feb', value: '80' },
    { label: 'Mar', value: '45' },
    { label: 'Apr', value: '90' },
    { label: 'May', value: '70' },
  ]);
  const [chartData, setChartData] = useState(null);
  const [error, setError] = useState('');
  const channelRef = useRef(null);

  // ---- Measured chart width — see DEFAULT_CHART_W comment above ----
  const [chartWidth, setChartWidth] = useState(DEFAULT_CHART_W);
  const onChartAreaLayout = (e) => {
    const { width } = e.nativeEvent.layout;
    // scroll container has 20px padding each side (see styles.scroll), and
    // the chart card has 14px padding each side (see styles.chartCard)
    const usable = width - 40 - 28;
    if (usable > 0) setChartWidth(usable);
  };

  // ---- Realtime sync ----
  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`graphboard-${sessionId}`)
      .on('broadcast', { event: 'chart' }, ({ payload }) => {
        setChartData(payload.chartData);
      })
      .on('broadcast', { event: 'clear' }, () => setChartData(null))
      .subscribe();
    channelRef.current = channel;
    return () => supabase.removeChannel(channel);
  }, [sessionId]);

  // ---- Persistence, so late joiners see the last plotted chart ----
  useEffect(() => {
    if (!sessionId) return;
    loadChart();
  }, [sessionId]);

  const loadChart = async () => {
    const { data, error: err } = await supabase
      .from('graph_boards')
      .select('chart_data')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (err) {
      console.warn('loadChart error', err);
      return;
    }
    if (data?.chart_data) setChartData(data.chart_data);
  };

  const persistChart = async (data) => {
    if (!sessionId) return;
    const { error: err } = await supabase
      .from('graph_boards')
      .upsert({ session_id: sessionId, chart_data: data, updated_at: new Date().toISOString() });
    if (err) console.warn('persistChart error', err);
  };

  const plotChart = () => {
    if (!effectiveCanEdit) return;
    setError('');
    let points = [];

    if (inputMode === 'equation') {
      const min = parseFloat(xMin);
      const max = parseFloat(xMax);
      if (isNaN(min) || isNaN(max) || min >= max) {
        return setError('Invalid x range. Make sure min < max.');
      }
      const steps = 100;
      const step = (max - min) / steps;
      for (let i = 0; i <= steps; i++) {
        const x = min + i * step;
        const y = evalEquation(equation, x);
        if (y !== null && !isNaN(y) && isFinite(y)) {
          points.push({ x, y });
        }
      }
      if (points.length === 0) return setError('Could not evaluate equation. Check syntax.');
    }

    if (inputMode === 'xytable') {
      points = xyRows
        .filter(r => r.x !== '' && r.y !== '')
        .map(r => ({ x: parseFloat(r.x), y: parseFloat(r.y) }))
        .filter(r => !isNaN(r.x) && !isNaN(r.y));
      if (points.length < 2) return setError('Add at least 2 valid X/Y pairs.');
    }

    if (inputMode === 'data') {
      points = dataRows
        .filter(r => r.label !== '' && r.value !== '')
        .map(r => ({ label: r.label, value: parseFloat(r.value) }))
        .filter(r => !isNaN(r.value));
      if (points.length < 2) return setError('Add at least 2 data rows.');
    }

    const data = {
      type: inputMode === 'data' ? 'bar' : chartType,
      mode: inputMode,
      points,
      xLabel,
      yLabel,
      equation: inputMode === 'equation' ? equation : null,
      title: inputMode === 'equation' ? `y = ${equation}` : `${xLabel} vs ${yLabel}`,
      authorName: currentUser?.name,
    };

    setChartData(data);
    channelRef.current?.send({ type: 'broadcast', event: 'chart', payload: { chartData: data } });
    persistChart(data);
  };

  const clearChart = () => {
    if (!effectiveCanEdit) return;
    setChartData(null);
    channelRef.current?.send({ type: 'broadcast', event: 'clear', payload: {} });
    persistChart(null);
  };

  const renderChart = (data) => {
    if (!data) return null;
    const { points, type, mode } = data;

    if (mode === 'data' || type === 'bar') {
      const maxVal = Math.max(...points.map(p => p.value));
      const barWidth = (chartWidth - PADDING * 2) / points.length * 0.7;
      const spacing = (chartWidth - PADDING * 2) / points.length;
      const barColors = ['#5B2EFF', '#FF3B3B', '#2ECC71', '#F5A623', '#00BCD4', '#FF69B4'];

      return (
        <Svg width={chartWidth} height={CHART_H}>
          <Line x1={PADDING} y1={PADDING} x2={PADDING} y2={CHART_H - PADDING} stroke="#999" strokeWidth={1} />
          <Line x1={PADDING} y1={CHART_H - PADDING} x2={chartWidth - 10} y2={CHART_H - PADDING} stroke="#999" strokeWidth={1} />
          {points.map((p, i) => {
            const barH = ((p.value / maxVal) * (CHART_H - PADDING * 2));
            const x = PADDING + i * spacing + spacing * 0.15;
            const y = CHART_H - PADDING - barH;
            return (
              <G key={i}>
                <Rect x={x} y={y} width={barWidth} height={barH} fill={barColors[i % barColors.length]} rx={4} opacity={0.85} />
                <SvgText x={x + barWidth / 2} y={CHART_H - PADDING + 14} fontSize={10} fill="#666" textAnchor="middle">{p.label}</SvgText>
                <SvgText x={x + barWidth / 2} y={y - 4} fontSize={10} fill="#333" textAnchor="middle" fontWeight="bold">{p.value}</SvgText>
              </G>
            );
          })}
        </Svg>
      );
    }

    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    const toSvgX = (x) => PADDING + ((x - minX) / rangeX) * (chartWidth - PADDING * 2);
    const toSvgY = (y) => CHART_H - PADDING - ((y - minY) / rangeY) * (CHART_H - PADDING * 2);

    const pathD = points.map((p, i) => {
      const sx = toSvgX(p.x).toFixed(1);
      const sy = toSvgY(p.y).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${sx},${sy}`;
    }).join(' ');

    const yTicks = [minY, (minY + maxY) / 2, maxY].map(v => ({ val: v.toFixed(1), y: toSvgY(v) }));
    const xTicks = [minX, (minX + maxX) / 2, maxX].map(v => ({ val: v.toFixed(1), x: toSvgX(v) }));

    return (
      <Svg width={chartWidth} height={CHART_H}>
        {yTicks.map((t, i) => (
          <Line key={i} x1={PADDING} y1={t.y} x2={chartWidth - 10} y2={t.y} stroke="#EEE" strokeWidth={1} />
        ))}
        <Line x1={PADDING} y1={PADDING} x2={PADDING} y2={CHART_H - PADDING} stroke="#999" strokeWidth={1.5} />
        <Line x1={PADDING} y1={CHART_H - PADDING} x2={chartWidth - 10} y2={CHART_H - PADDING} stroke="#999" strokeWidth={1.5} />
        {yTicks.map((t, i) => (
          <SvgText key={i} x={PADDING - 6} y={t.y + 4} fontSize={9} fill="#999" textAnchor="end">{t.val}</SvgText>
        ))}
        {xTicks.map((t, i) => (
          <SvgText key={i} x={t.x} y={CHART_H - PADDING + 14} fontSize={9} fill="#999" textAnchor="middle">{t.val}</SvgText>
        ))}
        {type === 'line' && (
          <Path d={pathD} stroke={colors.primary} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {(type === 'scatter' || type === 'line') && points.map((p, i) => (
          <Circle key={i} cx={toSvgX(p.x)} cy={toSvgY(p.y)} r={type === 'scatter' ? 5 : 3} fill={colors.primary} opacity={0.8} />
        ))}
        <SvgText x={chartWidth / 2} y={CHART_H - 4} fontSize={11} fill="#666" textAnchor="middle">{data.xLabel}</SvgText>
        <SvgText x={12} y={CHART_H / 2} fontSize={11} fill="#666" textAnchor="middle" rotation="-90" origin={`12,${CHART_H / 2}`}>{data.yLabel}</SvgText>
      </Svg>
    );
  };

  if (!visible) return null;
  const containerStyle = mode === 'embedded' ? styles.embeddedContainer : styles.fullscreenContainer;

  return (
    <View style={containerStyle}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onRequestClose}>
          <Text style={styles.backText}>{mode === 'embedded' ? '▾ Minimize' : '← Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Graph Board</Text>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {!effectiveCanEdit && (
        <View style={styles.viewOnlyBanner}>
          <Text style={styles.viewOnlyText}>
            {isHost
              ? "You're in view-only mode — tap Interrupt to take over"
              : "You're viewing this graph — you don't currently have edit access"}
          </Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scroll} onLayout={onChartAreaLayout}>
        {chartData ? (
          <View style={styles.chartCard}>
            <View style={styles.chartHeader}>
              <Text style={styles.chartTitle}>{chartData.title}</Text>
              {effectiveCanEdit && (
                <TouchableOpacity style={styles.clearChartBtn} onPress={clearChart}>
                  <Text style={styles.clearChartText}>🗑️ Clear</Text>
                </TouchableOpacity>
              )}
            </View>
            {renderChart(chartData)}
          </View>
        ) : (
          <View style={styles.emptyChart}>
            <Text style={styles.emptyChartText}>📊 Chart will appear here</Text>
          </View>
        )}

        {effectiveCanEdit && (
          <>
            <Text style={styles.sectionLabel}>Input Method</Text>
            <View style={styles.modeRow}>
              {inputModes.map(m => (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.modeBtn, inputMode === m.id && styles.modeBtnActive]}
                  onPress={() => setInputMode(m.id)}
                >
                  <Text style={styles.modeEmoji}>{m.emoji}</Text>
                  <Text style={[styles.modeLabel, inputMode === m.id && styles.modeLabelActive]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {inputMode !== 'data' && (
              <>
                <Text style={styles.sectionLabel}>Chart Type</Text>
                <View style={styles.chartTypeRow}>
                  {chartTypes.map(c => (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.chartTypeBtn, chartType === c.id && styles.chartTypeBtnActive]}
                      onPress={() => setChartType(c.id)}
                    >
                      <Text style={styles.chartTypeEmoji}>{c.emoji}</Text>
                      <Text style={[styles.chartTypeLabel, chartType === c.id && styles.chartTypeLabelActive]}>{c.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {inputMode === 'equation' && (
              <View style={styles.inputSection}>
                <Text style={styles.sectionLabel}>Equation (use x as variable)</Text>
                <View style={styles.equationBox}>
                  <Text style={styles.equationPrefix}>y = </Text>
                  <TextInput
                    style={styles.equationInput}
                    value={equation}
                    onChangeText={setEquation}
                    placeholder="x^2 + 2*x + 1"
                    placeholderTextColor={colors.grey}
                  />
                </View>
                <Text style={styles.hint}>Supports: +, -, *, /, ^, sin, cos, tan, sqrt, abs, pi, e</Text>
                <View style={styles.rangeRow}>
                  <View style={styles.rangeItem}>
                    <Text style={styles.rangeLabel}>x min</Text>
                    <TextInput style={styles.rangeInput} value={xMin} onChangeText={setXMin} keyboardType="numeric" />
                  </View>
                  <Text style={styles.rangeTo}>to</Text>
                  <View style={styles.rangeItem}>
                    <Text style={styles.rangeLabel}>x max</Text>
                    <TextInput style={styles.rangeInput} value={xMax} onChangeText={setXMax} keyboardType="numeric" />
                  </View>
                </View>
              </View>
            )}

            {inputMode === 'xytable' && (
              <View style={styles.inputSection}>
                <Text style={styles.sectionLabel}>X/Y Value Pairs</Text>
                <View style={styles.tableHeader}>
                  <Text style={styles.tableHeaderText}>X</Text>
                  <Text style={styles.tableHeaderText}>Y</Text>
                </View>
                {xyRows.map((row, i) => (
                  <View key={i} style={styles.tableRow}>
                    <TextInput
                      style={styles.tableInput}
                      value={row.x}
                      onChangeText={val => { const u = [...xyRows]; u[i].x = val; setXyRows(u); }}
                      keyboardType="numeric"
                      placeholder={`x${i + 1}`}
                      placeholderTextColor={colors.grey}
                    />
                    <TextInput
                      style={styles.tableInput}
                      value={row.y}
                      onChangeText={val => { const u = [...xyRows]; u[i].y = val; setXyRows(u); }}
                      keyboardType="numeric"
                      placeholder={`y${i + 1}`}
                      placeholderTextColor={colors.grey}
                    />
                    <TouchableOpacity style={styles.removeRowBtn} onPress={() => setXyRows(xyRows.filter((_, j) => j !== i))}>
                      <Text style={styles.removeRowText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity style={styles.addRowBtn} onPress={() => setXyRows([...xyRows, { x: '', y: '' }])}>
                  <Text style={styles.addRowText}>+ Add Row</Text>
                </TouchableOpacity>
              </View>
            )}

            {inputMode === 'data' && (
              <View style={styles.inputSection}>
                <Text style={styles.sectionLabel}>Data Rows (Label + Value)</Text>
                <View style={styles.tableHeader}>
                  <Text style={styles.tableHeaderText}>Label</Text>
                  <Text style={styles.tableHeaderText}>Value</Text>
                </View>
                {dataRows.map((row, i) => (
                  <View key={i} style={styles.tableRow}>
                    <TextInput
                      style={styles.tableInput}
                      value={row.label}
                      onChangeText={val => { const u = [...dataRows]; u[i].label = val; setDataRows(u); }}
                      placeholder="Label"
                      placeholderTextColor={colors.grey}
                    />
                    <TextInput
                      style={styles.tableInput}
                      value={row.value}
                      onChangeText={val => { const u = [...dataRows]; u[i].value = val; setDataRows(u); }}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={colors.grey}
                    />
                    <TouchableOpacity style={styles.removeRowBtn} onPress={() => setDataRows(dataRows.filter((_, j) => j !== i))}>
                      <Text style={styles.removeRowText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity style={styles.addRowBtn} onPress={() => setDataRows([...dataRows, { label: '', value: '' }])}>
                  <Text style={styles.addRowText}>+ Add Row</Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.sectionLabel}>Axis Labels</Text>
            <View style={styles.axisRow}>
              <View style={styles.axisItem}>
                <Text style={styles.axisHint}>X Axis</Text>
                <TextInput style={styles.axisInput} value={xLabel} onChangeText={setXLabel} placeholder="x" placeholderTextColor={colors.grey} />
              </View>
              <View style={styles.axisItem}>
                <Text style={styles.axisHint}>Y Axis</Text>
                <TextInput style={styles.axisInput} value={yLabel} onChangeText={setYLabel} placeholder="y" placeholderTextColor={colors.grey} />
              </View>
            </View>

            {error ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>⚠️ {error}</Text>
              </View>
            ) : null}

            <TouchableOpacity style={styles.plotBtn} onPress={plotChart}>
              <Text style={styles.plotBtnText}>📊 Plot Graph for Everyone</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fullscreenContainer: { flex: 1, backgroundColor: colors.background },
  embeddedContainer: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.background, zIndex: 50, elevation: 50,
  },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 40, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.greyLight },
  backText: { fontSize: 15, color: colors.primary, fontWeight: '600' },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFE8E8', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red },
  liveText: { color: colors.red, fontSize: 11, fontWeight: '700' },
  viewOnlyBanner: { backgroundColor: '#FFF6E5', paddingVertical: 6, alignItems: 'center' },
  viewOnlyText: { fontSize: 12, color: '#8A6D00', fontWeight: '600' },
  scroll: { padding: 20, gap: 12, paddingBottom: 50 },
  chartCard: { backgroundColor: colors.white, borderRadius: 16, padding: 14, elevation: 2 },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  chartTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  clearChartBtn: { padding: 6 },
  clearChartText: { fontSize: 13, color: colors.red },
  emptyChart: { backgroundColor: colors.white, borderRadius: 16, height: 200, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.greyLight, borderStyle: 'dashed' },
  emptyChartText: { color: colors.textLight, fontSize: 14 },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  modeRow: { flexDirection: 'row', gap: 10 },
  modeBtn: { flex: 1, alignItems: 'center', gap: 4, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: colors.greyLight, backgroundColor: colors.white },
  modeBtnActive: { borderColor: colors.primary, backgroundColor: '#F0ECFF' },
  modeEmoji: { fontSize: 20 },
  modeLabel: { fontSize: 11, fontWeight: '600', color: colors.grey },
  modeLabelActive: { color: colors.primary },
  chartTypeRow: { flexDirection: 'row', gap: 10 },
  chartTypeBtn: { flex: 1, alignItems: 'center', gap: 4, padding: 10, borderRadius: 12, borderWidth: 1.5, borderColor: colors.greyLight, backgroundColor: colors.white },
  chartTypeBtnActive: { borderColor: colors.primary, backgroundColor: '#F0ECFF' },
  chartTypeEmoji: { fontSize: 20 },
  chartTypeLabel: { fontSize: 11, fontWeight: '600', color: colors.grey },
  chartTypeLabelActive: { color: colors.primary },
  inputSection: { backgroundColor: colors.white, borderRadius: 16, padding: 14, gap: 10, elevation: 1 },
  equationBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.greyLight, borderRadius: 12, paddingHorizontal: 14, height: 52, borderWidth: 1, borderColor: colors.greyLight },
  equationPrefix: { fontSize: 16, fontWeight: '700', color: colors.text, marginRight: 4 },
  equationInput: { flex: 1, fontSize: 16, color: colors.text, outlineStyle: 'none' },
  hint: { fontSize: 11, color: colors.textLight },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rangeItem: { flex: 1, gap: 4 },
  rangeLabel: { fontSize: 12, fontWeight: '600', color: colors.textLight },
  rangeInput: { backgroundColor: colors.greyLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text, outlineStyle: 'none' },
  rangeTo: { fontSize: 14, color: colors.textLight, fontWeight: '600', marginTop: 16 },
  tableHeader: { flexDirection: 'row', gap: 10, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: colors.greyLight },
  tableHeaderText: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.textLight },
  tableRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  tableInput: { flex: 1, backgroundColor: colors.greyLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text, outlineStyle: 'none' },
  removeRowBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFE8E8', alignItems: 'center', justifyContent: 'center' },
  removeRowText: { color: colors.red, fontSize: 12, fontWeight: '700' },
  addRowBtn: { borderWidth: 1, borderColor: colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderStyle: 'dashed' },
  addRowText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  axisRow: { flexDirection: 'row', gap: 12 },
  axisItem: { flex: 1, gap: 4 },
  axisHint: { fontSize: 12, fontWeight: '600', color: colors.textLight },
  axisInput: { backgroundColor: colors.white, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.greyLight, outlineStyle: 'none' },
  errorCard: { backgroundColor: '#FFE8E8', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#FFB3B3' },
  errorText: { color: colors.red, fontSize: 13, fontWeight: '600' },
  plotBtn: { backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 16, alignItems: 'center', elevation: 8 },
  plotBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
});