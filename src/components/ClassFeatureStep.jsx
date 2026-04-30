/**
 * ClassFeatureStep — Auto-generates UI for class-specific feature selection.
 *
 * Reads from classFeatureRegistry to determine what features a class needs,
 * then renders the appropriate selectors (single dropdown, multi-select, etc.).
 * All enforcement and bonus application happens through the registry's apply() functions.
 */
import React, { useState, useMemo } from 'react';
import { getClassFeatures, FEATURE_TYPES } from '../utils/classFeatureRegistry';

const sty = {
  section: {
    marginBottom: 16, padding: 12, backgroundColor: '#16213e',
    border: '1px solid rgba(255,215,0,0.15)', borderRadius: 6,
  },
  sectionTitle: { color: '#ffd700', fontWeight: 700, fontSize: 14, marginBottom: 4 },
  sectionDesc: { color: '#8b949e', fontSize: 11, marginBottom: 10 },
  select: {
    width: '100%', padding: '8px 10px', background: '#0d1117',
    border: '1px solid #30363d', borderRadius: 4, color: '#e0d6c8', fontSize: 13,
  },
  optionDetail: { color: '#6b7b8e', fontSize: 10, padding: '2px 0 2px 12px' },
  multiGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6,
  },
  multiItem: (active) => ({
    padding: '8px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
    background: active ? '#1a2e4e' : '#0d1117',
    border: active ? '2px solid #ffd700' : '1px solid #30363d',
    color: active ? '#ffd700' : '#d4c5a9',
    fontWeight: active ? 600 : 400,
  }),
  tag: (color) => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10,
    background: color || '#2a2a4e', color: '#e0d6c8', marginRight: 4,
  }),
  error: { color: '#f85149', fontSize: 11, marginTop: 4, fontStyle: 'italic' },
  infoBox: {
    marginTop: 8, padding: 8, background: '#0d1117', borderRadius: 4,
    border: '1px solid #1e2a3a', fontSize: 11, color: '#b0a690', lineHeight: 1.5,
  },
  required: { color: '#f85149', marginLeft: 4, fontSize: 10 },
};

export default function ClassFeatureStep({ char, setChar, styles }) {
  const features = useMemo(() => getClassFeatures(char.class), [char.class]);
  const [expandedDetail, setExpandedDetail] = useState(null);

  if (!features.length) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: '#6b7b8e' }}>
        <div style={{ fontSize: 14, marginBottom: 8 }}>{char.class || 'This class'} has no additional feature selections.</div>
        <div style={{ fontSize: 12 }}>Continue to the next step.</div>
      </div>
    );
  }

  const handleSingleSelect = (dataKey, value) => {
    setChar(prev => ({ ...prev, [dataKey]: value || '' }));
  };

  const handleMultiToggle = (dataKey, value, maxCount) => {
    setChar(prev => {
      const current = Array.isArray(prev[dataKey]) ? [...prev[dataKey]] : [];
      const idx = current.indexOf(value);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else if (current.length < maxCount) {
        current.push(value);
      }
      return { ...prev, [dataKey]: current };
    });
  };

  return (
    <div>
      <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 12 }}>
        Configure your {char.class}'s class features:
      </div>

      {features.map((feature) => {
        // Check conditional features
        if (feature.condition && !feature.condition(char)) return null;

        const options = feature.getOptions(char);
        const currentValue = char[feature.dataKey];
        const error = feature.required ? feature.validate?.(currentValue, char, feature) : null;

        // Get selected option's detail for display
        const selectedOption = feature.selectType === 'single'
          ? options.find(o => feature.getOptionValue(o) === currentValue)
          : null;

        return (
          <div key={feature.type + '-' + feature.dataKey} style={sty.section}>
            <div style={sty.sectionTitle}>
              {feature.label}
              {feature.required && <span style={sty.required}>*required</span>}
            </div>
            <div style={sty.sectionDesc}>{feature.description}</div>

            {/* SINGLE SELECT */}
            {feature.selectType === 'single' && (
              <>
                <select
                  style={sty.select}
                  value={currentValue || ''}
                  onChange={(e) => handleSingleSelect(feature.dataKey, e.target.value)}
                >
                  <option value="">— Select {feature.label} —</option>
                  {options.map(opt => (
                    <option key={feature.getOptionValue(opt)} value={feature.getOptionValue(opt)}>
                      {feature.getOptionLabel(opt)}
                    </option>
                  ))}
                </select>

                {/* Show detail for selected option */}
                {selectedOption && (
                  <div style={sty.infoBox}>
                    {feature.getOptionDetail(selectedOption)}
                  </div>
                )}
              </>
            )}

            {/* MULTI SELECT */}
            {feature.selectType === 'multi' && (
              <>
                <div style={{ fontSize: 11, color: '#6b7b8e', marginBottom: 6 }}>
                  Select {feature.count || 2} — {Array.isArray(currentValue) ? currentValue.length : 0}/{feature.count || 2} chosen
                </div>
                <div style={sty.multiGrid}>
                  {options.map(opt => {
                    const val = feature.getOptionValue(opt);
                    const isActive = Array.isArray(currentValue) && currentValue.includes(val);
                    return (
                      <div
                        key={val}
                        style={sty.multiItem(isActive)}
                        onClick={() => handleMultiToggle(feature.dataKey, val, feature.count || 2)}
                      >
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>{feature.getOptionLabel(opt)}</div>
                        {expandedDetail === val ? (
                          <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>
                            {feature.getOptionDetail(opt)}
                          </div>
                        ) : (
                          <div
                            style={{ fontSize: 9, color: '#4a5a6e', cursor: 'pointer', marginTop: 2 }}
                            onClick={(e) => { e.stopPropagation(); setExpandedDetail(expandedDetail === val ? null : val); }}
                          >
                            [details]
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Validation error */}
            {error && <div style={sty.error}>{error}</div>}
          </div>
        );
      })}
    </div>
  );
}
