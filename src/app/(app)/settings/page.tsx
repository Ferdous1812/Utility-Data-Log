'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { addMeter, updateMeter, deleteMeter, updateMetersOrder, addMeterSection, updateMeterSection, deleteMeterSection, renameEquipmentCategory, deleteEquipmentCategory } from '@/lib/actions';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge, MeterTypeBadge } from '@/components/ui/Badge';
import { MeterForm } from '@/components/MeterForm';
import { Tabs } from '@/components/ui/Tabs';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import type { Meter, MeterSection, CustomTierLabels } from '@/lib/types';
import { DEFAULT_TIER_LABELS } from '@/lib/types';
import type { HourEquipmentGroup } from '@/types/hour';

function getSectionDomain(sec?: MeterSection | null): 'energy' | 'gas' | 'hour' {
  if (!sec) return 'energy';
  const name = (sec.name || '').toLowerCase();
  const unit = (sec.unit || '').toLowerCase();
  if (name.includes('hour') || unit === 'hrs' || unit === 'hr' || unit.includes('hour')) return 'hour';
  if (name.includes('gas') || name.includes('rms') || unit === 'm³' || unit === 'm3' || unit.includes('m3') || unit.includes('m³')) return 'gas';
  return 'energy';
}

export default function SettingsPage() {
  const supabase = createClient();
  const { addToast } = useToast();

  // Shared Data State
  const [meters, setMeters] = useState<Meter[]>([]);
  const [sections, setSections] = useState<MeterSection[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const activeSection = sections.find((sec) => sec.id === (activeSectionId || sections[0]?.id));

  // Meters Tab State
  const [meterFormOpen, setMeterFormOpen] = useState(false);
  const [editingMeter, setEditingMeter] = useState<Meter | null>(null);
  const [meterSubmitting, setMeterSubmitting] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [newSectionIcon, setNewSectionIcon] = useState('');
  const [newSectionColor, setNewSectionColor] = useState('accent');
  const [newSectionUnit, setNewSectionUnit] = useState('kWh');
  const [sectionCreating, setSectionCreating] = useState(false);
  const [showSectionForm, setShowSectionForm] = useState(false);
  const [editingSection, setEditingSection] = useState<MeterSection | null>(null);
  const [editSectionName, setEditSectionName] = useState('');
  const [editSectionUnit, setEditSectionUnit] = useState('kWh');
  const [sectionUpdating, setSectionUpdating] = useState(false);

  // Hierarchy Tier Names Customization
  const [tierLabels, setTierLabels] = useState<CustomTierLabels>(DEFAULT_TIER_LABELS);
  const [showTierModal, setShowTierModal] = useState(false);
  const [tempTierLabels, setTempTierLabels] = useState<CustomTierLabels>(DEFAULT_TIER_LABELS);

  // Equipment Category Management
  const [categoryRenameTarget, setCategoryRenameTarget] = useState<string | null>(null);
  const [categoryNewName, setCategoryNewName] = useState('');
  const [categoryActionLoading, setCategoryActionLoading] = useState(false);
  const [manualOldCategory, setManualOldCategory] = useState('');
  const [manualNewCategory, setManualNewCategory] = useState('');

  // Load custom tier names from localStorage on client
  useEffect(() => {
    try {
      const saved = localStorage.getItem('utility_tier_labels');
      if (saved) {
        const parsed = JSON.parse(saved);
        setTierLabels({ ...DEFAULT_TIER_LABELS, ...parsed });
        setTempTierLabels({ ...DEFAULT_TIER_LABELS, ...parsed });
      }
    } catch (e) {}
  }, []);

  // Sorting & Collapsing State for Meters
  type SortField = 'name' | 'category' | 'location' | 'parent' | 'mf';
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [collapsedMeterIds, setCollapsedMeterIds] = useState<Set<string>>(new Set());
  const [openMenuMeterId, setOpenMenuMeterId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close kebab menu on outside click
  useEffect(() => {
    if (!openMenuMeterId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuMeterId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenuMeterId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [metersRes, sectionsRes, energyMetersRes, gasMetersRes, hourMetersRes] = await Promise.all([
      supabase.from('meters').select('*').eq('is_active', true).order('sort_order', { ascending: true }).order('name'),
      supabase.from('meter_sections').select('*').order('sort_order', { ascending: true }),
      supabase.from('energy_meters').select('id, category, is_primary_for_total, reading_mode, devices:energy_meter_devices(id, checkpoint_label, sort_order)').eq('is_active', true),
      supabase.from('gas_meters').select('id, category, is_primary_for_total').eq('is_active', true),
      supabase.from('hour_meters').select('id, equipment_group, category').eq('is_active', true),
    ]);

    // Merge domain-specific fields onto meter objects so the form can pre-populate them
    const energyMap = new Map<string, { category: string; is_primary_for_total: boolean; reading_mode: string; branches: { id: string; label: string }[] }>();
    (energyMetersRes.data || []).forEach((em: any) => {
      energyMap.set(em.id, {
        category: em.category,
        is_primary_for_total: em.is_primary_for_total,
        reading_mode: em.reading_mode || 'checkpoint',
        branches: [...(em.devices || [])]
          .sort((a: any, b: any) => a.sort_order - b.sort_order)
          .map((d: any) => ({ id: d.id, label: d.checkpoint_label })),
      });
    });

    const gasMap = new Map<string, { category: string; is_primary_for_total: boolean }>();
    (gasMetersRes.data || []).forEach((gm: any) => {
      gasMap.set(gm.id, { category: gm.category, is_primary_for_total: gm.is_primary_for_total });
    });

    const hourMap = new Map<string, { equipment_group: string; category: string }>();
    (hourMetersRes.data || []).forEach((hm: any) => {
      hourMap.set(hm.id, { equipment_group: hm.equipment_group, category: hm.category });
    });

    const metersMerged = (metersRes.data || []).map((m: any) => {
      const energy = energyMap.get(m.id);
      const gas = gasMap.get(m.id);
      const hour = hourMap.get(m.id);
      return {
        ...m,
        energy_category: energy?.category || '',
        reading_mode: energy?.reading_mode || 'checkpoint',
        energy_branches: energy?.branches || [],
        gas_category: gas?.category || '',
        equipment_group: hour?.equipment_group,
        category: hour?.category || gas?.category || energy?.category || '',
        is_primary_for_total: (gas?.is_primary_for_total ?? energy?.is_primary_for_total) ?? (m.type === 'incoming' || m.type === 'main'),
        is_in_energy_meters: !!energy,
        is_in_gas_meters: !!gas,
        is_in_hour_meters: !!hour,
      };
    });

    setMeters(metersMerged as Meter[]);
    setSections((sectionsRes.data || []) as MeterSection[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (sections.length > 0 && !activeSectionId) {
      setActiveSectionId(sections[0].id);
    }
  }, [sections, activeSectionId]);

  const sectionTabs = useMemo(() => {
    const tabs = sections.map((sec) => {
      const count = meters.filter((m) => m.section_id === sec.id).length;
      return {
        id: sec.id,
        label: sec.name,
        badge: count,
      };
    });
    const uncategorizedCount = meters.filter((m) => !m.section_id).length;
    if (uncategorizedCount > 0 && sections.length > 0) {
      tabs.push({
        id: '__uncategorized__',
        label: 'Uncategorized',
        badge: uncategorizedCount,
      });
    }
    return tabs;
  }, [sections, meters]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortField(null);
        setSortDirection('asc');
      }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const toggleCollapse = (meterId: string) => {
    setCollapsedMeterIds((prev) => {
      const next = new Set(prev);
      if (next.has(meterId)) {
        next.delete(meterId);
      } else {
        next.add(meterId);
      }
      return next;
    });
  };

  // ─── Meter Tab Helpers & Logic ───
  const meterMap = useMemo(() => new Map<string, Meter>(meters.map((m) => [m.id, m])), [meters]);

  const getParentName = useCallback((meter: Meter) => {
    if (!meter.parent_meter_id) return '—';
    const parent = meterMap.get(meter.parent_meter_id);
    return parent ? parent.name : '—';
  }, [meterMap]);

  const sortMetersList = useCallback((meterList: Meter[]) => {
    if (!sortField) return meterList;
    return [...meterList].sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';

      switch (sortField) {
        case 'name':
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
          break;
        case 'category':
          valA = a.type;
          valB = b.type;
          break;
        case 'location':
          valA = a.location.toLowerCase();
          valB = b.location.toLowerCase();
          break;
        case 'parent':
          valA = getParentName(a).toLowerCase();
          valB = getParentName(b).toLowerCase();
          break;
        case 'mf':
          valA = a.multiplication_factor ?? 1;
          valB = b.multiplication_factor ?? 1;
          break;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [sortField, sortDirection, getParentName]);

  const rawIncomingMeters = useMemo(() => meters.filter((m) => m.type === 'incoming' || m.type === 'main'), [meters]);
  const rawMotherMeters = useMemo(() => meters.filter((m) => m.type === 'outgoing_main' || m.type === 'outgoing'), [meters]);
  const rawSubMeters = useMemo(() => meters.filter((m) => m.type === 'outgoing_sub' || m.type === 'submeter'), [meters]);
  const rawSubSubMeters = useMemo(() => meters.filter((m) => m.type === 'outgoing_sub_sub'), [meters]);

  const incomingMeters = useMemo(() => sortMetersList(rawIncomingMeters), [rawIncomingMeters, sortMetersList]);
  const motherMeters = useMemo(() => sortMetersList(rawMotherMeters), [rawMotherMeters, sortMetersList]);
  const subMeters = useMemo(() => sortMetersList(rawSubMeters), [rawSubMeters, sortMetersList]);
  const subSubMeters = useMemo(() => sortMetersList(rawSubSubMeters), [rawSubSubMeters, sortMetersList]);

  const potentialParentMeters = useMemo(() => meters.filter(
    (m) => m.type === 'incoming' || m.type === 'main' || m.type === 'outgoing_main' || m.type === 'outgoing' || m.type === 'outgoing_sub' || m.type === 'submeter'
  ), [meters]);

  const handleAddMeter = async (data: any) => {
    setMeterSubmitting(true);
    try {
      const result = await addMeter(data);
      if (result.success) {
        addToast('success', result.message);
        setMeterFormOpen(false);
        fetchData();
      } else {
        addToast('error', result.message);
      }
    } catch (err: any) {
      console.error('Failed to add meter:', err);
      addToast('error', err?.message || 'Failed to add meter');
    } finally {
      setMeterSubmitting(false);
    }
  };

  const handleUpdateMeter = async (data: any) => {
    if (!editingMeter) return;
    setMeterSubmitting(true);
    try {
      const result = await updateMeter(editingMeter.id, data);
      if (result.success) {
        addToast('success', result.message);
        setEditingMeter(null);
        fetchData();
      } else {
        addToast('error', result.message);
      }
    } catch (err: any) {
      console.error('Failed to update meter:', err);
      addToast('error', err?.message || 'Failed to update meter');
    } finally {
      setMeterSubmitting(false);
    }
  };

  const handleDeleteMeter = async (meter: Meter) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${meter.name}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    const result = await deleteMeter(meter.id);
    if (result.success) {
      addToast('success', result.message);
      fetchData();
    } else {
      addToast('error', result.message);
    }
  };

  const handleAddSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSectionName.trim()) return;
    setSectionCreating(true);
    const result = await addMeterSection(newSectionName, newSectionIcon, newSectionColor, newSectionUnit);
    if (result.success) {
      addToast('success', result.message);
      setNewSectionName('');
      setNewSectionUnit('kWh');
      setShowSectionForm(false);
      fetchData();
    } else {
      addToast('error', result.message);
    }
    setSectionCreating(false);
  };

  const openEditSection = (section: MeterSection) => {
    setEditingSection(section);
    setEditSectionName(section.name);
    setEditSectionUnit(section.unit || 'kWh');
  };

  const handleUpdateSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSection) return;
    if (!editSectionName.trim()) {
      addToast('error', 'Section name is required');
      return;
    }
    setSectionUpdating(true);
    const result = await updateMeterSection(editingSection.id, editSectionName.trim(), editSectionUnit.trim());
    if (result.success) {
      addToast('success', result.message);
      setEditingSection(null);
      fetchData();
    } else {
      addToast('error', result.message);
    }
    setSectionUpdating(false);
  };

  const openTierModal = () => {
    setTempTierLabels(tierLabels);
    setShowTierModal(true);
  };

  const handleSaveTierLabels = (e: React.FormEvent) => {
    e.preventDefault();
    setTierLabels(tempTierLabels);
    try {
      localStorage.setItem('utility_tier_labels', JSON.stringify(tempTierLabels));
      window.dispatchEvent(new Event('utility_tier_labels_changed'));
    } catch (e) {}
    addToast('success', 'Hierarchy tier names updated successfully!');
    setShowTierModal(false);
  };

  const handleResetTierLabels = () => {
    setTempTierLabels(DEFAULT_TIER_LABELS);
    setTierLabels(DEFAULT_TIER_LABELS);
    try {
      localStorage.removeItem('utility_tier_labels');
      window.dispatchEvent(new Event('utility_tier_labels_changed'));
    } catch (e) {}
    addToast('success', 'Hierarchy tiers reset to defaults.');
  };

  // Distinct equipment categories in use across meters
  const uniqueEquipmentCategories = useMemo(() => {
    const counts = new Map<string, number>();
    meters.forEach((m: any) => {
      const cat = (m.energy_category || m.category || '').trim();
      if (cat && cat.toLowerCase() !== 'general') {
        counts.set(cat, (counts.get(cat) || 0) + 1);
      }
    });
    return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
  }, [meters]);

  const handleRenameCategory = async (oldName: string, newName: string) => {
    if (!newName.trim()) {
      addToast('error', 'New category name is required');
      return;
    }
    setCategoryActionLoading(true);
    try {
      const res = await renameEquipmentCategory(oldName, newName.trim());
      if (res.success) {
        addToast('success', res.message);
        setCategoryRenameTarget(null);
        setCategoryNewName('');
        setManualOldCategory('');
        setManualNewCategory('');
        fetchData();
      } else {
        addToast('error', res.message);
      }
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to rename category');
    } finally {
      setCategoryActionLoading(false);
    }
  };

  const handleDeleteCategory = async (catName: string) => {
    if (!window.confirm(`Are you sure you want to clear category "${catName}" from all meters?`)) return;
    setCategoryActionLoading(true);
    try {
      const res = await deleteEquipmentCategory(catName);
      if (res.success) {
        addToast('success', res.message);
        fetchData();
      } else {
        addToast('error', res.message);
      }
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to clear category');
    } finally {
      setCategoryActionLoading(false);
    }
  };

  const handleDeleteSection = async (section: MeterSection) => {
    const meterCount = meters.filter((m) => m.section_id === section.id).length;
    const msg = meterCount > 0
      ? `"${section.name}" has ${meterCount} assigned meter(s). Are you sure you want to delete this section?`
      : `Are you sure you want to delete section "${section.name}"?`;
    if (!window.confirm(msg)) return;

    const result = await deleteMeterSection(section.id);
    if (result.success) {
      addToast('success', result.message);
      fetchData();
    } else {
      addToast('error', result.message);
    }
  };

  const getSubMetersForParent = useCallback((parentId: string) => {
    return subMeters.filter((m) => m.parent_meter_id === parentId);
  }, [subMeters]);

  const getSubSubMetersForParent = useCallback((parentId: string) => {
    return subSubMeters.filter((m) => m.parent_meter_id === parentId);
  }, [subSubMeters]);

  const unassignedSubMeters = useMemo(() => sortMetersList(subMeters.filter(
    (m) => !m.parent_meter_id || !meterMap.has(m.parent_meter_id)
  )), [subMeters, meterMap, sortMetersList]);

  const unassignedSubSubMeters = useMemo(() => sortMetersList(subSubMeters.filter(
    (m) => !m.parent_meter_id || !meterMap.has(m.parent_meter_id)
  )), [subSubMeters, meterMap, sortMetersList]);

  const expandAllMeters = () => setCollapsedMeterIds(new Set());
  const collapseAllMeters = () => {
    const parentIds = meters
      .filter((m) => meters.some((child) => child.parent_meter_id === m.id))
      .map((m) => m.id);
    setCollapsedMeterIds(new Set(parentIds));
  };

  const handleMoveMeterInList = async (
    list: Meter[],
    index: number,
    direction: 'up' | 'down'
  ) => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;

    const updatedList = [...list];
    const temp = updatedList[index];
    updatedList[index] = updatedList[targetIndex];
    updatedList[targetIndex] = temp;

    const newMeters = [...meters];
    const idxA = newMeters.findIndex((m) => m.id === list[index].id);
    const idxB = newMeters.findIndex((m) => m.id === list[targetIndex].id);

    if (idxA !== -1 && idxB !== -1) {
      const t = newMeters[idxA];
      newMeters[idxA] = newMeters[idxB];
      newMeters[idxB] = t;
    }

    setMeters(newMeters);

    const orderedIds = newMeters.map((m) => m.id);
    const res = await updateMetersOrder(orderedIds);
    if (!res.success) {
      addToast('error', res.message);
      fetchData();
    }
  };

function DomainMeterBadge({ meter, domain, tierLabels }: { meter: Meter; domain: 'energy' | 'gas' | 'hour'; tierLabels?: CustomTierLabels }) {
  const labels = tierLabels || DEFAULT_TIER_LABELS;
  if (domain === 'hour') {
    const grp = (meter as any).equipment_group || (meter as any).category || 'Other';
    const label =
      grp === 'Compressor' ? labels.hour_compressor || 'Compressor'
      : grp === 'Pump' ? labels.hour_pump || 'Pump'
      : grp === 'Generator' ? labels.hour_generator || 'Generator'
      : labels.hour_other || 'Other Machinery';
    const variant = grp === 'Compressor' ? 'accent' : grp === 'Pump' ? 'success' : grp === 'Generator' ? 'warning' : 'default';
    return <Badge variant={variant}>{label}</Badge>;
  }

  if (domain === 'gas') {
    if (meter.type === 'incoming' || meter.type === 'main') {
      return <Badge variant="warning">{labels.gas_incoming || 'RMS Incomer'}</Badge>;
    }
    if (meter.type === 'outgoing_main' || meter.type === 'outgoing') {
      return <Badge variant="accent">{labels.gas_outgoing_main || 'Gas Header'}</Badge>;
    }
    if (meter.type === 'outgoing_sub_sub') {
      return <Badge variant="danger">{labels.gas_outgoing_sub_sub || 'Sub-Appliance'}</Badge>;
    }
    return <Badge variant="success">{labels.gas_outgoing_sub || 'Appliance Sub'}</Badge>;
  }

  // Energy
  if (meter.type === 'incoming' || meter.type === 'main') {
    return <Badge variant="warning">{labels.incoming || 'Incoming Feeder'}</Badge>;
  }
  if (meter.type === 'outgoing_main' || meter.type === 'outgoing') {
    return <Badge variant="accent">{labels.outgoing_main || 'Mother Panel'}</Badge>;
  }
  if (meter.type === 'outgoing_sub_sub') {
    return <Badge variant="danger">{labels.outgoing_sub_sub || 'Sub-Submeter'}</Badge>;
  }
  return <Badge variant="success">{labels.outgoing_sub || 'Breaker Submeter'}</Badge>;
}

  const renderMeterRow = (
    meter: Meter,
    level = 0,
    childCount = 0,
    idx = 0,
    siblingsCount = 1,
    onMove?: (direction: 'up' | 'down') => void,
    domain: 'energy' | 'gas' | 'hour' = 'energy'
  ) => {
    const hasChildren = childCount > 0;
    const isCollapsed = collapsedMeterIds.has(meter.id);

    const plClass =
      level === 0 ? 'pl-2.5' :
      level === 1 ? 'pl-6' :
      level === 2 ? 'pl-10' :
      'pl-14';

    const branchPrefix =
      level === 1 ? '└─ ' :
      level === 2 ? '└─── ' :
      level >= 3 ? '└───── ' :
      '';

    const branchColor =
      level === 1 ? 'text-accent/80' :
      level === 2 ? 'text-success/80' :
      'text-danger/80';

    return (
      <tr
        key={meter.id}
        className={`transition-colors hover:bg-bg-surface-hover/70 ${
          level >= 2
            ? 'bg-bg-primary/50'
            : level === 1
            ? 'bg-bg-primary/25'
            : idx % 2 === 0
            ? 'bg-transparent'
            : 'bg-bg-surface-hover/15'
        }`}
      >
        <td
          className={`sticky left-0 z-10 py-1.5 font-medium truncate backdrop-blur-xs ${plClass} ${
            level > 0 ? 'bg-bg-elevated/95' : 'text-text-primary bg-bg-elevated/95'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {level > 0 && (
              <span className={`font-mono text-[11px] shrink-0 font-bold ${branchColor}`}>
                {branchPrefix}
              </span>
            )}

            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleCollapse(meter.id)}
                className="p-0.5 text-accent hover:bg-accent/10 rounded transition-all flex items-center gap-1.5 focus:outline-none min-w-0 cursor-pointer"
                title={isCollapsed ? 'Expand branch meters' : 'Collapse branch meters'}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className={`shrink-0 transition-transform duration-200 ${
                    isCollapsed ? '-rotate-90 text-text-muted' : 'rotate-0 text-accent'
                  }`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span className="truncate text-xs font-semibold">{meter.name}</span>
                <span className="text-[10px] font-normal px-1.5 py-0.2 rounded-full bg-accent/15 text-accent shrink-0">
                  {childCount}
                </span>
              </button>
            ) : (
              <span className={`truncate text-xs ${level === 0 ? 'font-medium text-text-primary' : 'text-text-secondary'}`}>
                {meter.name}
              </span>
            )}
          </div>
        </td>
        <td className="px-2 py-1.5">
          <DomainMeterBadge meter={meter} domain={domain} tierLabels={tierLabels} />
        </td>
        <td className="px-2 py-1.5 text-text-muted text-xs truncate" title={meter.location}>
          {meter.location || '—'}
        </td>
        <td className="px-2 py-1.5 text-xs text-accent font-medium truncate" title={getParentName(meter)}>
          {getParentName(meter)}
        </td>
        <td className="px-1.5 py-1.5 text-center font-bold tabular-nums text-accent text-xs">
          {(() => {
            const v = meter.multiplication_factor ?? 1;
            const intPart = Math.floor(Math.abs(v));
            const fracPart = Math.abs(v) - intPart;
            const sign = v < 0 ? '-' : '';
            return '×' + sign + String(intPart).padStart(3, '0') + '.' + fracPart.toFixed(2).slice(2);
          })()}
        </td>
        <td className="px-2 py-1.5 text-right">
          <div className="relative inline-block" ref={openMenuMeterId === meter.id ? menuRef : undefined}>
            <button
              type="button"
              onClick={() => setOpenMenuMeterId(openMenuMeterId === meter.id ? null : meter.id)}
              className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-surface-hover rounded transition-colors cursor-pointer"
              title="Actions"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
            {openMenuMeterId === meter.id && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[150px] bg-bg-elevated border border-border/80 rounded-[var(--radius-md)] shadow-lg py-1 animate-fade-in">
                {/* Edit */}
                <button
                  type="button"
                  onClick={() => { setEditingMeter(meter); setOpenMenuMeterId(null); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors cursor-pointer"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  Edit
                </button>
                {/* Move Up */}
                {onMove && (
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => { onMove('up'); setOpenMenuMeterId(null); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-accent/10 hover:text-accent disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                    Move Up
                  </button>
                )}
                {/* Move Down */}
                {onMove && (
                  <button
                    type="button"
                    disabled={idx === siblingsCount - 1}
                    onClick={() => { onMove('down'); setOpenMenuMeterId(null); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-accent/10 hover:text-accent disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                    Move Down
                  </button>
                )}
                {/* Divider */}
                <div className="my-1 border-t border-border/50" />
                {/* Delete */}
                <button
                  type="button"
                  onClick={() => { handleDeleteMeter(meter); setOpenMenuMeterId(null); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Delete
                </button>
              </div>
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="max-w-7xl mx-auto animate-fade-in space-y-4">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-border/40">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">System Settings</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Configure incoming power feeders, mother panels, and submeter hierarchy
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={openTierModal}
            className="text-xs"
            title="Edit feeder hierarchy tiers, run hours machinery groups, and equipment categories"
          >
            Edit Category
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSectionForm(true)}
            className="text-xs"
          >
            + Add Section
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setMeterFormOpen(true)}
            className="text-xs"
          >
            + Add Meter
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Section Tabs & Quick Rename */}
          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
            {sectionTabs.length > 0 && (
              <Tabs
                tabs={sectionTabs}
                activeTab={activeSectionId || (sections[0]?.id ?? '')}
                onChange={(id) => setActiveSectionId(id)}
                className="mb-0 flex-1 min-w-[280px]"
              />
            )}
            {activeSection && activeSectionId !== '__uncategorized__' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openEditSection(activeSection)}
                className="text-xs h-8 shrink-0 text-accent hover:bg-accent/10 border-accent/30"
                title="Rename this section/category tab"
              >
                Rename Tab
              </Button>
            )}
          </div>

          {/* Main Table Content */}
          {meters.length === 0 ? (
            <div className="text-center py-12 border border-border/80 rounded-[var(--radius-md)] bg-bg-elevated text-text-muted shadow-xs">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-2 opacity-40">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              <p className="text-xs font-semibold text-text-primary">No meters configured yet</p>
              <p className="text-[11px] text-text-muted mt-0.5">Add your first meter or section to get started</p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <Button variant="outline" size="sm" onClick={() => setShowSectionForm(true)} className="text-xs">
                  + Add Section
                </Button>
                <Button variant="primary" size="sm" onClick={() => setMeterFormOpen(true)} className="text-xs">
                  + Add Meter
                </Button>
              </div>
            </div>
          ) : sections.length > 0 ? (
            <div className="space-y-4">
              {activeSectionId !== '__uncategorized__' &&
                sections
                  .filter((sec) => sec.id === (activeSectionId || sections[0]?.id))
                  .map((sec) => {
                    const secMeters = meters.filter((m) => m.section_id === sec.id);
                    const domain = getSectionDomain(sec);
                    const secMeterIds = new Set(secMeters.map((m) => m.id));

                    // Recursive node renderer for hierarchical tree structures (Gas and Electricity)
                    const renderMeterNode = (meter: Meter, level = 0, siblings: Meter[], idx: number) => {
                      const children = sortMetersList(secMeters.filter((m) => m.parent_meter_id === meter.id));
                      const isCollapsed = collapsedMeterIds.has(meter.id);

                      return (
                        <React.Fragment key={meter.id}>
                          {renderMeterRow(
                            meter,
                            level,
                            children.length,
                            idx,
                            siblings.length,
                            (dir) => handleMoveMeterInList(siblings, idx, dir),
                            domain
                          )}
                          {!isCollapsed &&
                            children.map((child, cIdx) =>
                              renderMeterNode(child, level + 1, children, cIdx)
                            )}
                        </React.Fragment>
                      );
                    };

                    // Feeder / RMS Root meters (incoming)
                    const incomingRoots = sortMetersList(
                      secMeters.filter((m) => m.type === 'incoming' || m.type === 'main')
                    );

                    // Standalone Mother Panels / Headers that are NOT children of incoming meters in this section
                    const standaloneMotherRoots = sortMetersList(
                      secMeters.filter(
                        (m) =>
                          (m.type === 'outgoing_main' || m.type === 'outgoing') &&
                          (!m.parent_meter_id || !secMeterIds.has(m.parent_meter_id))
                      )
                    );

                    // Unassigned Submeters (submeters whose parent is missing or not in this section)
                    const unassignedSubMeters = sortMetersList(
                      secMeters.filter(
                        (m) =>
                          (m.type === 'outgoing_sub' || m.type === 'outgoing_sub_sub' || m.type === 'submeter') &&
                          (!m.parent_meter_id || !secMeterIds.has(m.parent_meter_id))
                      )
                    );

                    // Hour meter machinery equipment groups
                    const hourGroups: { key: HourEquipmentGroup; label: string }[] = [
                      { key: 'Compressor', label: tierLabels.hour_compressor || 'Air Compressors' },
                      { key: 'Pump', label: tierLabels.hour_pump || 'Pumps & Circulation Systems' },
                      { key: 'Generator', label: tierLabels.hour_generator || 'Generators (Engine Run Hours)' },
                      { key: 'Other', label: tierLabels.hour_other || 'Other Machinery & Auxiliaries' },
                    ];

                    return (
                      <div key={sec.id} className="border border-border/80 rounded-[var(--radius-md)] bg-bg-elevated shadow-xs overflow-hidden">
                        {/* Sleek Top Toolbar */}
                        <div className="px-3 py-1.5 bg-bg-surface-hover/50 border-b border-border flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent/15 text-accent">
                              {secMeters.length} {secMeters.length === 1 ? 'Meter' : 'Meters'}
                            </span>
                            <span className="text-[10px] text-text-muted">
                              • Unit: <span className="font-medium text-text-secondary">{sec.unit || 'kWh'}</span>
                            </span>
                            <span className="text-[10px] text-text-muted font-medium bg-bg-surface px-1.5 py-0.5 rounded border border-border/40">
                              {domain === 'hour' ? 'Run Hours' : domain === 'gas' ? 'Gas Hierarchy' : 'Energy Hierarchy'}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {secMeters.length > 0 && domain !== 'hour' && (
                              <div className="flex items-center gap-1 text-[11px]">
                                <button
                                  type="button"
                                  onClick={expandAllMeters}
                                  className="px-2 py-0.5 rounded bg-bg-surface hover:bg-bg-surface-hover text-accent font-medium transition-colors border border-border/60 cursor-pointer"
                                  title="Expand all branches"
                                >
                                  ▼ Expand All
                                </button>
                                <button
                                  type="button"
                                  onClick={collapseAllMeters}
                                  className="px-2 py-0.5 rounded bg-bg-surface hover:bg-bg-surface-hover text-text-secondary font-medium transition-colors border border-border/60 cursor-pointer"
                                  title="Collapse all branches"
                                >
                                  ► Collapse All
                                </button>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditSection(sec)}
                              className="text-text-muted hover:text-accent p-1 rounded hover:bg-accent/10 transition-colors cursor-pointer"
                              title="Edit / Rename Section"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSection(sec)}
                              className="text-text-muted hover:text-danger p-1 rounded hover:bg-danger/10 transition-colors cursor-pointer"
                              title="Delete Section"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setMeterFormOpen(true)}
                              className="text-xs h-7 px-2"
                            >
                              + Add Meter
                            </Button>
                          </div>
                        </div>

                        {/* Section Table Body */}
                        {secMeters.length === 0 ? (
                          <div className="text-center py-8 px-4 text-text-muted">
                            <p className="text-xs font-medium text-text-secondary">No meters in {sec.name} section yet.</p>
                            <p className="text-[11px] mt-0.5 text-text-muted">
                              Click &ldquo;+ Add Meter&rdquo; to configure meters under this section.
                            </p>
                          </div>
                        ) : (
                          <div className="overflow-x-auto max-h-[65vh]">
                            <table className="w-full text-xs border-collapse table-fixed min-w-[760px]">
                              <colgroup>
                                <col className="w-[220px] sm:w-[260px]" />
                                <col className="w-[120px]" />
                                <col className="w-[120px]" />
                                <col className="w-[130px]" />
                                <col className="w-[70px]" />
                                <col className="w-[90px]" />
                              </colgroup>
                              <thead className="bg-table-header text-[10px] font-bold uppercase tracking-wider text-white border-b border-border select-none sticky top-0 z-20">
                                <tr>
                                  <th className="sticky left-0 z-30 bg-table-header px-2.5 py-1.5 text-left text-white border-none">
                                    <button
                                      type="button"
                                      onClick={() => handleSort('name')}
                                      className={`inline-flex items-center gap-1 hover:text-accent transition-colors cursor-pointer bg-transparent border-0 border-none outline-none shadow-none focus:outline-none focus:ring-0 text-[10px] font-bold uppercase tracking-wider ${sortField === 'name' ? 'text-accent' : 'text-white'}`}
                                    >
                                      Meter Name {sortField === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                                    </button>
                                  </th>
                                  <th className="px-2 py-1.5 text-left text-white border-none">
                                    <button
                                      type="button"
                                      onClick={() => handleSort('category')}
                                      className={`inline-flex items-center gap-1 hover:text-accent transition-colors cursor-pointer bg-transparent border-0 border-none outline-none shadow-none focus:outline-none focus:ring-0 text-[10px] font-bold uppercase tracking-wider ${sortField === 'category' ? 'text-accent' : 'text-white'}`}
                                    >
                                      {domain === 'hour' ? 'Group / Type' : domain === 'gas' ? 'Gas Category' : 'Feeder Category'} {sortField === 'category' && (sortDirection === 'asc' ? '↑' : '↓')}
                                    </button>
                                  </th>
                                  <th className="px-2 py-1.5 text-left text-white border-none">
                                    <button
                                      type="button"
                                      onClick={() => handleSort('location')}
                                      className={`inline-flex items-center gap-1 hover:text-accent transition-colors cursor-pointer bg-transparent border-0 border-none outline-none shadow-none focus:outline-none focus:ring-0 text-[10px] font-bold uppercase tracking-wider ${sortField === 'location' ? 'text-accent' : 'text-white'}`}
                                    >
                                      Location {sortField === 'location' && (sortDirection === 'asc' ? '↑' : '↓')}
                                    </button>
                                  </th>
                                  <th className="px-2 py-1.5 text-left text-white border-none">
                                    <button
                                      type="button"
                                      onClick={() => handleSort('parent')}
                                      className={`inline-flex items-center gap-1 hover:text-accent transition-colors cursor-pointer bg-transparent border-0 border-none outline-none shadow-none focus:outline-none focus:ring-0 text-[10px] font-bold uppercase tracking-wider ${sortField === 'parent' ? 'text-accent' : 'text-white'}`}
                                    >
                                      {domain === 'hour' ? 'Application' : domain === 'gas' ? 'Parent (Header / RMS)' : 'Parent (Mother Panel)'} {sortField === 'parent' && (sortDirection === 'asc' ? '↑' : '↓')}
                                    </button>
                                  </th>
                                  <th className="px-1.5 py-1.5 text-center text-white border-none">
                                    <button
                                      type="button"
                                      onClick={() => handleSort('mf')}
                                      className={`inline-flex items-center gap-1 hover:text-accent transition-colors cursor-pointer bg-transparent border-0 border-none outline-none shadow-none focus:outline-none focus:ring-0 text-[10px] font-bold uppercase tracking-wider ${sortField === 'mf' ? 'text-accent' : 'text-white'}`}
                                    >
                                      M.F {sortField === 'mf' && (sortDirection === 'asc' ? '↑' : '↓')}
                                    </button>
                                  </th>
                                  <th className="px-2 py-1.5 text-right text-white border-none">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/60">
                                {domain === 'hour' ? (
                                  /* Run Hours Machinery layout grouped by equipment_group */
                                  hourGroups.map((grp) => {
                                    const groupMeters = sortMetersList(
                                      secMeters.filter((m) => {
                                        const rawGroup = (m as any).equipment_group || (m as any).category;
                                        if (grp.key === 'Other') {
                                          return !rawGroup || !['Compressor', 'Pump', 'Generator'].includes(rawGroup);
                                        }
                                        return rawGroup === grp.key;
                                      })
                                    );
                                    if (groupMeters.length === 0) return null;

                                    return (
                                      <React.Fragment key={grp.key}>
                                        <tr className="bg-accent/10 border-y border-accent/20">
                                          <td colSpan={6} className="px-2.5 py-1 font-bold text-accent text-[10px] uppercase tracking-wider">
                                            {grp.label} ({groupMeters.length})
                                          </td>
                                        </tr>
                                        {groupMeters.map((m, idx) =>
                                          renderMeterRow(
                                            m,
                                            0,
                                            0,
                                            idx,
                                            groupMeters.length,
                                            (dir) => handleMoveMeterInList(groupMeters, idx, dir),
                                            domain
                                          )
                                        )}
                                      </React.Fragment>
                                    );
                                  })
                                ) : (
                                  /* Hierarchical Tree for Gas and Electricity */
                                  <>
                                    {/* Incoming Feeders / RMS Feeders */}
                                    {incomingRoots.length > 0 && (
                                      <>
                                        <tr className="bg-warning/10 border-y border-warning/20">
                                          <td colSpan={6} className="px-2.5 py-1 font-bold text-warning text-[10px] uppercase tracking-wider">
                                            {domain === 'gas' ? 'RMS Room / Main Incomers' : 'Incoming Feeders & Sources'} ({incomingRoots.length})
                                          </td>
                                        </tr>
                                        {incomingRoots.map((root, idx) =>
                                          renderMeterNode(root, 0, incomingRoots, idx)
                                        )}
                                      </>
                                    )}

                                    {/* Standalone Mother Panels / Headers */}
                                    {standaloneMotherRoots.length > 0 && (
                                      <>
                                        <tr className="bg-accent/10 border-y border-accent/20">
                                          <td colSpan={6} className="px-2.5 py-1 font-bold text-accent text-[10px] uppercase tracking-wider">
                                            {domain === 'gas' ? 'Standalone Distribution Headers' : 'Standalone Mother Panels & Feeder Trees'} ({standaloneMotherRoots.length})
                                          </td>
                                        </tr>
                                        {standaloneMotherRoots.map((root, idx) =>
                                          renderMeterNode(root, 0, standaloneMotherRoots, idx)
                                        )}
                                      </>
                                    )}

                                    {/* Unassigned Submeters (if any) */}
                                    {unassignedSubMeters.length > 0 && (
                                      <>
                                        <tr className="bg-danger/10 border-y border-danger/20">
                                          <td colSpan={6} className="px-2.5 py-1 font-bold text-danger text-[10px] uppercase tracking-wider">
                                            Unassigned Submeters ({unassignedSubMeters.length}) — No Parent Feeder/Header Assigned
                                          </td>
                                        </tr>
                                        {unassignedSubMeters.map((m, idx) =>
                                          renderMeterRow(
                                            m,
                                            0,
                                            0,
                                            idx,
                                            unassignedSubMeters.length,
                                            (dir) => handleMoveMeterInList(unassignedSubMeters, idx, dir),
                                            domain
                                          )
                                        )}
                                      </>
                                    )}
                                  </>
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}

              {/* Uncategorized Meters Card */}
              {activeSectionId === '__uncategorized__' && meters.some((m) => !m.section_id) && (
                <div className="border border-border/80 rounded-[var(--radius-md)] bg-bg-elevated shadow-xs overflow-hidden">
                  <div className="px-3 py-1.5 bg-bg-surface-hover/50 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-text-muted/15 text-text-secondary border border-border">
                        {meters.filter((m) => !m.section_id).length} Meters
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-[65vh]">
                    <table className="w-full text-xs border-collapse table-fixed min-w-[760px]">
                      <colgroup>
                        <col className="w-[220px] sm:w-[260px]" />
                        <col className="w-[110px]" />
                        <col className="w-[130px]" />
                        <col className="w-[130px]" />
                        <col className="w-[70px]" />
                        <col className="w-[90px]" />
                      </colgroup>
                      <thead className="bg-table-header text-[10px] font-bold uppercase tracking-wider text-white border-b border-border select-none sticky top-0 z-20">
                        <tr>
                          <th className="sticky left-0 z-30 bg-table-header px-2.5 py-1.5 text-left text-white border-none">Meter Name</th>
                          <th className="px-2 py-1.5 text-left text-white border-none">Category</th>
                          <th className="px-2 py-1.5 text-left text-white border-none">Location</th>
                          <th className="px-2 py-1.5 text-left text-white border-none">Parent (Mother)</th>
                          <th className="px-1.5 py-1.5 text-center text-white border-none">M.F</th>
                          <th className="px-2 py-1.5 text-right text-white border-none">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {meters.filter((m) => !m.section_id).map((m, idx, arr) =>
                          renderMeterRow(m, 0, 0, idx, arr.length, undefined, 'energy')
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Fallback single table when no sections are defined */
            <div className="border border-border/80 rounded-[var(--radius-md)] bg-bg-elevated shadow-xs overflow-hidden">
              <div className="overflow-x-auto max-h-[65vh]">
                <table className="w-full text-xs border-collapse table-fixed min-w-[760px]">
                  <colgroup>
                    <col className="w-[220px] sm:w-[260px]" />
                    <col className="w-[110px]" />
                    <col className="w-[130px]" />
                    <col className="w-[130px]" />
                    <col className="w-[70px]" />
                    <col className="w-[90px]" />
                  </colgroup>
                  <thead className="bg-table-header text-[10px] font-bold uppercase tracking-wider text-white border-b border-border select-none sticky top-0 z-20">
                    <tr>
                      <th className="sticky left-0 z-30 bg-table-header px-2.5 py-1.5 text-left text-white border-none">Meter Name</th>
                      <th className="px-2 py-1.5 text-left text-white border-none">Category</th>
                      <th className="px-2 py-1.5 text-left text-white border-none">Location</th>
                      <th className="px-2 py-1.5 text-left text-white border-none">Parent (Mother)</th>
                      <th className="px-1.5 py-1.5 text-center text-white border-none">M.F</th>
                      <th className="px-2 py-1.5 text-right text-white border-none">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {incomingMeters.map((m, idx) => renderMeterRow(m, 0, 0, idx, incomingMeters.length, undefined, 'energy'))}
                    {motherMeters.map((m, idx) => renderMeterRow(m, 0, 0, idx, motherMeters.length, undefined, 'energy'))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Section Modal */}
      <Modal
        open={showSectionForm}
        onClose={() => setShowSectionForm(false)}
        title="Add Meter Section"
        compact
        maxWidth="440px"
      >
        <form onSubmit={handleAddSection} className="p-4 space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">
              Section Name <span className="text-danger">*</span>
            </label>
            <Input
              placeholder="e.g. Steam Meter, Gas Feeder, Generator"
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">
              Unit
            </label>
            <Input
              placeholder="e.g. kWh, m³, hrs"
              value={newSectionUnit}
              onChange={(e) => setNewSectionUnit(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowSectionForm(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={sectionCreating}
            >
              Create Section
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit / Rename Section Modal */}
      <Modal
        open={!!editingSection}
        onClose={() => setEditingSection(null)}
        title={`Edit Section: ${editingSection?.name || ''}`}
        compact
        maxWidth="440px"
      >
        <form onSubmit={handleUpdateSection} className="p-4 space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">
              Section Name <span className="text-danger">*</span>
            </label>
            <Input
              placeholder="e.g. Energy Meter, Gas Meter, RMS Room"
              value={editSectionName}
              onChange={(e) => setEditSectionName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">
              Unit
            </label>
            <Input
              placeholder="e.g. kWh, m³, hrs"
              value={editSectionUnit}
              onChange={(e) => setEditSectionUnit(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border/60">
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => {
                if (editingSection) {
                  const target = editingSection;
                  setEditingSection(null);
                  handleDeleteSection(target);
                }
              }}
            >
              Delete Section
            </Button>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditingSection(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={sectionUpdating}
              >
                Save Changes
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Rename Feeder Tiers Modal */}
      {/* Edit Category Modal */}
      <Modal
        open={showTierModal}
        onClose={() => setShowTierModal(false)}
        title="Edit Category"
        compact
        maxWidth="640px"
      >
        <form onSubmit={handleSaveTierLabels} className="p-3.5 space-y-3">
          {/* Electricity Hierarchy Tiers */}
          <div className="space-y-1.5">
            <h4 className="text-[11px] font-bold text-accent uppercase tracking-wider">
              Electricity Hierarchy Tiers
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Input
                label="Tier 0"
                placeholder="Incoming Feeder"
                value={tempTierLabels.incoming}
                onChange={(e) => setTempTierLabels((p) => ({ ...p, incoming: e.target.value }))}
                required
              />
              <Input
                label="Tier 1"
                placeholder="Mother Panel"
                value={tempTierLabels.outgoing_main}
                onChange={(e) => setTempTierLabels((p) => ({ ...p, outgoing_main: e.target.value }))}
                required
              />
              <Input
                label="Tier 2"
                placeholder="Breaker Submeter"
                value={tempTierLabels.outgoing_sub}
                onChange={(e) => setTempTierLabels((p) => ({ ...p, outgoing_sub: e.target.value }))}
                required
              />
              <Input
                label="Tier 3"
                placeholder="Sub-Submeter"
                value={tempTierLabels.outgoing_sub_sub}
                onChange={(e) => setTempTierLabels((p) => ({ ...p, outgoing_sub_sub: e.target.value }))}
                required
              />
            </div>
          </div>

          {/* Gas Hierarchy Tiers */}
          <div className="space-y-1.5 pt-2 border-t border-border/50">
            <h4 className="text-[11px] font-bold text-warning uppercase tracking-wider">
              Gas Hierarchy Tiers
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Input
                label="Tier 0"
                placeholder="RMS Incomer"
                value={tempTierLabels.gas_incoming}
                onChange={(e) => setTempTierLabels((p) => ({ ...p, gas_incoming: e.target.value }))}
                required
              />
              <Input
                label="Tier 1"
                placeholder="Gas Header"
                value={tempTierLabels.gas_outgoing_main}
                onChange={(e) => setTempTierLabels((p) => ({ ...p, gas_outgoing_main: e.target.value }))}
                required
              />
              <Input
                label="Tier 2"
                placeholder="Appliance Sub"
                value={tempTierLabels.gas_outgoing_sub}
                onChange={(e) => setTempTierLabels((p) => ({ ...p, gas_outgoing_sub: e.target.value }))}
                required
              />
              <Input
                label="Tier 3"
                placeholder="Sub-Appliance"
                value={tempTierLabels.gas_outgoing_sub_sub}
                onChange={(e) => setTempTierLabels((p) => ({ ...p, gas_outgoing_sub_sub: e.target.value }))}
                required
              />
            </div>
          </div>

          {/* Run Hours Machinery Groups */}
          <div className="space-y-1.5 pt-2 border-t border-border/50">
            <h4 className="text-[11px] font-bold text-success uppercase tracking-wider">
              Run Hours Machinery Groups
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Input
                label="Group 1"
                placeholder="Compressor"
                value={tempTierLabels.hour_compressor}
                onChange={(e) => setTempTierLabels((p) => ({ ...p, hour_compressor: e.target.value }))}
                required
              />
              <Input
                label="Group 2"
                placeholder="Pump"
                value={tempTierLabels.hour_pump}
                onChange={(e) => setTempTierLabels((p) => ({ ...p, hour_pump: e.target.value }))}
                required
              />
              <Input
                label="Group 3"
                placeholder="Generator"
                value={tempTierLabels.hour_generator}
                onChange={(e) => setTempTierLabels((p) => ({ ...p, hour_generator: e.target.value }))}
                required
              />
              <Input
                label="Group 4"
                placeholder="Other Machinery"
                value={tempTierLabels.hour_other}
                onChange={(e) => setTempTierLabels((p) => ({ ...p, hour_other: e.target.value }))}
                required
              />
            </div>
          </div>

          {/* Equipment Categories Management */}
          <div className="space-y-2 pt-2 border-t border-border/50">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-bold text-text-primary uppercase tracking-wider">
                Equipment Categories ({uniqueEquipmentCategories.length})
              </h4>
              <span className="text-[10px] text-text-muted">REB, Generator, Solar, Boiler, etc.</span>
            </div>

            {uniqueEquipmentCategories.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 max-h-[110px] overflow-y-auto p-1.5 rounded bg-bg-surface border border-border/60">
                {uniqueEquipmentCategories.map((c) => (
                  <div
                    key={c.name}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-bg-elevated border border-border text-xs"
                  >
                    {categoryRenameTarget === c.name ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={categoryNewName}
                          onChange={(e) => setCategoryNewName(e.target.value)}
                          className="px-1.5 py-0.5 text-xs bg-bg-surface border border-accent rounded w-24 text-text-primary focus:outline-none"
                          autoFocus
                          placeholder="New name"
                        />
                        <button
                          type="button"
                          disabled={categoryActionLoading}
                          onClick={() => handleRenameCategory(c.name, categoryNewName)}
                          className="px-1.5 py-0.5 text-[10px] bg-accent text-white rounded font-medium disabled:opacity-50 cursor-pointer"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setCategoryRenameTarget(null)}
                          className="px-1 text-[10px] text-text-muted hover:text-text-primary cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="font-semibold text-text-primary">{c.name}</span>
                        <span className="text-[10px] text-text-muted">({c.count})</span>
                        <button
                          type="button"
                          onClick={() => {
                            setCategoryRenameTarget(c.name);
                            setCategoryNewName(c.name);
                          }}
                          className="text-accent hover:underline text-[10px] ml-0.5 cursor-pointer font-medium"
                          title="Rename category across all meters"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(c.name)}
                          className="text-text-muted hover:text-danger text-[10px] cursor-pointer ml-0.5"
                          title="Clear category from all meters"
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-text-muted italic py-1.5 px-2 bg-bg-surface rounded border border-border/50 text-center">
                No custom equipment categories assigned to meters yet.
              </p>
            )}

            {/* Quick Rename Tool */}
            <div className="flex items-center gap-1.5 pt-1">
              <input
                type="text"
                placeholder="Current category name..."
                value={manualOldCategory}
                onChange={(e) => setManualOldCategory(e.target.value)}
                className="flex-1 px-2 py-1 text-xs bg-bg-surface border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
              <span className="text-text-muted text-xs">→</span>
              <input
                type="text"
                placeholder="New name..."
                value={manualNewCategory}
                onChange={(e) => setManualNewCategory(e.target.value)}
                className="flex-1 px-2 py-1 text-xs bg-bg-surface border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={categoryActionLoading || !manualOldCategory.trim() || !manualNewCategory.trim()}
                onClick={() => handleRenameCategory(manualOldCategory, manualNewCategory)}
                className="text-xs h-7 px-2.5 shrink-0"
              >
                Rename
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2.5 border-t border-border/60">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleResetTierLabels}
              className="text-xs text-text-muted hover:text-danger h-7 px-2"
            >
              Reset to Defaults
            </Button>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowTierModal(false)}
                className="text-xs h-7 px-3"
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" className="text-xs h-7 px-3">
                Save
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Add Meter Modal */}
      <MeterForm
        open={meterFormOpen}
        onClose={() => setMeterFormOpen(false)}
        onSubmit={handleAddMeter}
        mainMeters={potentialParentMeters}
        allMeters={meters}
        sections={sections}
        defaultSectionId={activeSectionId !== '__uncategorized__' ? activeSectionId : undefined}
        loading={meterSubmitting}
      />

      {/* Edit Meter Modal */}
      <MeterForm
        open={!!editingMeter}
        onClose={() => setEditingMeter(null)}
        onSubmit={handleUpdateMeter}
        meter={editingMeter}
        mainMeters={potentialParentMeters}
        allMeters={meters}
        sections={sections}
        defaultSectionId={editingMeter?.section_id || undefined}
        loading={meterSubmitting}
      />
    </div>
  );
}
