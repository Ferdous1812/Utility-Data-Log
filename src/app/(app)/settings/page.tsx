'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { addMeter, updateMeter, deleteMeter, updateMetersOrder, addMeterSection, deleteMeterSection } from '@/lib/actions';
import { addUnit, deleteUnit, updateUnitAllocations, updateUnitsOrder } from '@/lib/unitActions';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { MeterTypeBadge } from '@/components/ui/Badge';
import { MeterForm } from '@/components/MeterForm';
import { useToast } from '@/components/ui/Toast';
import type { Meter, Unit, UnitAllocation, MeterSection } from '@/lib/types';

export default function SettingsPage() {
  const supabase = createClient();
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState<'meters' | 'units'>('meters');

  // Shared Data State
  const [meters, setMeters] = useState<Meter[]>([]);
  const [sections, setSections] = useState<MeterSection[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [allocations, setAllocations] = useState<UnitAllocation[]>([]);
  const [loading, setLoading] = useState(true);

  // Meters Tab State
  const [meterFormOpen, setMeterFormOpen] = useState(false);
  const [editingMeter, setEditingMeter] = useState<Meter | null>(null);
  const [meterSubmitting, setMeterSubmitting] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [newSectionIcon, setNewSectionIcon] = useState('⚡');
  const [newSectionColor, setNewSectionColor] = useState('accent');
  const [newSectionUnit, setNewSectionUnit] = useState('kWh');
  const [sectionCreating, setSectionCreating] = useState(false);
  const [showSectionForm, setShowSectionForm] = useState(false);

  // Sorting & Collapsing State for Meters
  type SortField = 'name' | 'category' | 'location' | 'parent' | 'mf';
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [collapsedMeterIds, setCollapsedMeterIds] = useState<Set<string>>(new Set());

  // Units Tab State
  const [newUnitName, setNewUnitName] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [unitSaving, setUnitSaving] = useState(false);
  const [unitCreating, setUnitCreating] = useState(false);
  const [localAllocations, setLocalAllocations] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [unitsRes, metersRes, allocationsRes, sectionsRes] = await Promise.all([
      supabase.from('units').select('*').order('sort_order', { ascending: true }),
      supabase.from('meters').select('*').eq('is_active', true).order('sort_order', { ascending: true }).order('name'),
      supabase.from('unit_allocations').select('*'),
      supabase.from('meter_sections').select('*').order('sort_order', { ascending: true }),
    ]);

    const fetchedUnits = (unitsRes.data || []) as Unit[];
    setUnits(fetchedUnits);
    setMeters((metersRes.data || []) as Meter[]);
    setAllocations((allocationsRes.data || []) as UnitAllocation[]);
    setSections((sectionsRes.data || []) as MeterSection[]);

    if (fetchedUnits.length > 0 && !selectedUnitId) {
      setSelectedUnitId(fetchedUnits[0].id);
    }
    setLoading(false);
  }, [supabase, selectedUnitId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Load allocations for selected unit into local state
  useEffect(() => {
    if (!selectedUnitId) {
      setLocalAllocations({});
      return;
    }
    const unitAlloc = allocations.filter((a) => a.unit_id === selectedUnitId);
    const mapping: Record<string, string> = {};
    unitAlloc.forEach((a) => {
      mapping[a.meter_id] = String(a.percentage);
    });
    setLocalAllocations(mapping);
  }, [selectedUnitId, allocations]);

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
    const result = await addMeter(data);
    if (result.success) {
      addToast('success', result.message);
      setMeterFormOpen(false);
      fetchData();
    } else {
      addToast('error', result.message);
    }
    setMeterSubmitting(false);
  };

  const handleUpdateMeter = async (data: any) => {
    if (!editingMeter) return;
    setMeterSubmitting(true);
    const result = await updateMeter(editingMeter.id, data);
    if (result.success) {
      addToast('success', result.message);
      setEditingMeter(null);
      fetchData();
    } else {
      addToast('error', result.message);
    }
    setMeterSubmitting(false);
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

  const renderMeterRow = (
    meter: Meter,
    isChild = false,
    isGrandchild = false,
    idx = 0,
    siblingsCount = 1,
    onMove?: (direction: 'up' | 'down') => void
  ) => {
    const children = getSubMetersForParent(meter.id);
    const grandchildren = getSubSubMetersForParent(meter.id);
    const childCount = children.length + grandchildren.length;
    const hasChildren = childCount > 0;
    const isCollapsed = collapsedMeterIds.has(meter.id);

    return (
      <tr
        key={meter.id}
        className={`border-b border-border/50 transition-colors hover:bg-bg-surface-hover ${
          isGrandchild ? 'bg-bg-primary/60' : isChild ? 'bg-bg-primary/70' : idx % 2 === 0 ? 'bg-bg-surface' : 'bg-bg-primary/50'
        }`}
      >
        <td className={`px-4 py-3 font-medium ${isGrandchild ? 'pl-14 text-text-muted' : isChild ? 'pl-9 text-text-secondary' : 'text-text-primary'}`}>
          <div className="flex items-center gap-2">
            {isGrandchild && <span className="text-danger/70 font-mono text-xs">└─</span>}
            {isChild && !isGrandchild && <span className="text-accent/70 font-mono text-xs">└─</span>}

            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleCollapse(meter.id)}
                className="p-1 text-accent hover:bg-accent/10 rounded transition-all flex items-center gap-1 focus:outline-none"
                title={isCollapsed ? "Expand submeters" : "Collapse submeters"}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className={`transition-transform duration-200 ${isCollapsed ? '-rotate-90 text-text-muted' : 'rotate-0 text-accent'}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span>{meter.name}</span>
                <span className="text-[11px] font-normal px-1.5 py-0.5 rounded-full bg-accent/15 text-accent">
                  {childCount} sub
                </span>
              </button>
            ) : (
              <span>{meter.name}</span>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          <MeterTypeBadge type={meter.type} />
        </td>
        <td className="px-4 py-3 text-text-secondary">{meter.location}</td>
        <td className="px-4 py-3 font-medium text-accent">{getParentName(meter)}</td>
        <td className="px-4 py-3 text-center font-bold tabular-nums text-accent">
          {meter.multiplication_factor ?? 1}×
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-1.5">
            {onMove && (
              <div className="flex items-center gap-0.5 mr-1">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => onMove('up')}
                  className="text-text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-30 disabled:pointer-events-none p-1.5 rounded-md transition-colors"
                  title="Move Up"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </button>
                <button
                  type="button"
                  disabled={idx === siblingsCount - 1}
                  onClick={() => onMove('down')}
                  className="text-text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-30 disabled:pointer-events-none p-1.5 rounded-md transition-colors"
                  title="Move Down"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setEditingMeter(meter)}
              className="text-accent/80 hover:text-accent bg-accent/10 hover:bg-accent/20 p-1.5 rounded-md transition-colors"
              title="Edit Meter"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleDeleteMeter(meter)}
              className="text-danger/80 hover:text-danger bg-danger/10 hover:bg-danger/20 p-1.5 rounded-md transition-colors"
              title="Delete Meter"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </td>
      </tr>
    );
  };

  // ─── Unit Tab Helpers & Logic ───
  const outgoingMetersOnly = useMemo(() => {
    return meters.filter((m) => {
      const isOutgoingType =
        m.type === 'outgoing_main' ||
        m.type === 'outgoing' ||
        m.type === 'outgoing_sub' ||
        m.type === 'submeter' ||
        m.type === 'outgoing_sub_sub';
      if (!isOutgoingType) return false;

      // Only include meters belonging to a KW (kWh/Energy) section
      const section = sections.find((s) => s.id === m.section_id);
      const isKwMeter = !!section?.unit?.trim().toLowerCase().startsWith('kw');
      if (!isKwMeter) return false;

      // Exclude meters whose location is 'NA'
      if (m.location?.trim().toUpperCase() === 'NA') return false;

      return true;
    });
  }, [meters, sections]);

  const meterTotalAllocations = useMemo(() => {
    const totals: Record<string, number> = {};
    allocations.forEach((a) => {
      if (a.unit_id !== selectedUnitId) {
        totals[a.meter_id] = (totals[a.meter_id] || 0) + Number(a.percentage);
      }
    });
    return totals;
  }, [allocations, selectedUnitId]);

  // Tree Helper Functions
  const getRootMeterId = useCallback((meterId: string): string => {
    let current = meterMap.get(meterId);
    while (current?.parent_meter_id) {
      const parent = meterMap.get(current.parent_meter_id);
      if (!parent) break;
      current = parent;
    }
    return current?.id || meterId;
  }, [meterMap]);

  const getDescendantIds = useCallback((parentId: string): string[] => {
    const descendants: string[] = [];
    const queue = [parentId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const children = meters.filter((m) => m.parent_meter_id === currentId);
      children.forEach((c) => {
        descendants.push(c.id);
        queue.push(c.id);
      });
    }
    return descendants;
  }, [meters]);

  const getTreeMeterIds = useCallback((meterId: string): string[] => {
    const rootId = getRootMeterId(meterId);
    return [rootId, ...getDescendantIds(rootId)];
  }, [getRootMeterId, getDescendantIds]);

  const getTreeTotalAllocated = useCallback((meterId: string, currentEdits: Record<string, string>) => {
    const treeIds = getTreeMeterIds(meterId);
    let total = 0;
    treeIds.forEach((id) => {
      if (currentEdits[id] !== undefined) {
        total += parseFloat(currentEdits[id]) || 0;
      } else {
        const savedThisUnit = allocations.find((a) => a.unit_id === selectedUnitId && a.meter_id === id);
        total += savedThisUnit ? Number(savedThisUnit.percentage) : 0;
      }
      total += meterTotalAllocations[id] || 0;
    });
    return total;
  }, [getTreeMeterIds, allocations, selectedUnitId, meterTotalAllocations]);

  const handleCreateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUnitName.trim()) return;

    setUnitCreating(true);
    const res = await addUnit(newUnitName.trim());
    if (res.success) {
      addToast('success', res.message);
      setNewUnitName('');
      fetchData();
    } else {
      addToast('error', res.message);
    }
    setUnitCreating(false);
  };

  const handleDeleteUnit = async (unit: Unit) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${unit.name}"? All associated meter allocations will be removed.`
    );
    if (!confirmed) return;

    const res = await deleteUnit(unit.id);
    if (res.success) {
      addToast('success', res.message);
      if (selectedUnitId === unit.id) {
        setSelectedUnitId('');
      }
      fetchData();
    } else {
      addToast('error', res.message);
    }
  };

  const handleMoveUnit = async (index: number, direction: 'up' | 'down') => {
    const newUnits = [...units];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newUnits.length) return;

    // Swap elements
    const temp = newUnits[index];
    newUnits[index] = newUnits[targetIndex];
    newUnits[targetIndex] = temp;

    // Optimistic update
    setUnits(newUnits);

    // Persist backend
    const orderedIds = newUnits.map((u) => u.id);
    const res = await updateUnitsOrder(orderedIds);
    if (!res.success) {
      addToast('error', res.message);
      // Re-fetch to roll back
      fetchData();
    }
  };

  const handlePercentageChange = (meterId: string, val: string) => {
    setLocalAllocations((prev) => ({
      ...prev,
      [meterId]: val,
    }));
  };

  const handleSaveAllocations = async () => {
    if (!selectedUnitId) return;

    const formatted: { meter_id: string; percentage: number }[] = [];
    let hasValidationError = false;

    // 1. Basic validation (value bounds)
    Object.entries(localAllocations).forEach(([meterId, val]) => {
      if (!val || val.trim() === '' || Number(val) === 0) return;

      const pct = parseFloat(val);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        addToast('error', 'Percentages must be between 0 and 100');
        hasValidationError = true;
        return;
      }
    });

    if (hasValidationError) return;

    // Validate individual meter allocations first to prevent any single meter crossing 100%
    for (const meter of meters) {
      const otherPct = meterTotalAllocations[meter.id] || 0;
      const localVal = localAllocations[meter.id] || '';
      const localPct = parseFloat(localVal) || 0;
      const totalPct = otherPct + localPct;

      if (totalPct > 100) {
        addToast(
          'error',
          `Total allocation for meter "${meter.name}" cannot exceed 100% (currently ${totalPct}%)`
        );
        hasValidationError = true;
        break;
      }
    }

    if (hasValidationError) return;

    // 2. Build local draft view of all allocations to validate subtree sums
    const draftAllocations: Record<string, number> = {};
    // Populate with existing allocations of other units
    Object.entries(meterTotalAllocations).forEach(([meterId, val]) => {
      draftAllocations[meterId] = val;
    });
    // Overlay local edits
    Object.entries(localAllocations).forEach(([meterId, val]) => {
      const pct = parseFloat(val) || 0;
      if (pct > 0) {
        draftAllocations[meterId] = pct;
      } else {
        delete draftAllocations[meterId];
      }
    });

    // Validate that for every meter, its tree total sum <= 100%
    for (const meter of meters) {
      const rootId = getRootMeterId(meter.id);
      const treeIds = [rootId, ...getDescendantIds(rootId)];
      let treeSum = 0;
      treeIds.forEach((id) => {
        treeSum += draftAllocations[id] || 0;
      });

      if (treeSum > 100) {
        const rootMeter = meterMap.get(rootId);
        addToast(
          'error',
          `Total allocations under tree "${rootMeter?.name || 'Meter'}" exceed 100% (currently ${treeSum}%)`
        );
        hasValidationError = true;
        break;
      }
    }

    if (hasValidationError) return;

    // Build format rows to save
    Object.entries(localAllocations).forEach(([meterId, val]) => {
      if (!val || val.trim() === '' || Number(val) === 0) return;
      formatted.push({ meter_id: meterId, percentage: parseFloat(val) });
    });

    setUnitSaving(true);
    const res = await updateUnitAllocations(selectedUnitId, formatted);
    if (res.success) {
      addToast('success', res.message);
      fetchData();
    } else {
      addToast('error', res.message);
    }
    setUnitSaving(false);
  };

  const selectedUnit = units.find((u) => u.id === selectedUnitId);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">System Settings</h1>
          <p className="text-sm text-text-secondary mt-1">
            Configure incoming power feeders, mother panels, submeter hierarchy, and define Major Unit consumption allocations
          </p>
        </div>
 
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab('meters')}
          className={`py-2.5 px-4 font-semibold text-sm transition-all border-b-2 -mb-px ${
            activeTab === 'meters'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          Meters Configuration
        </button>
        <button
          onClick={() => setActiveTab('units')}
          className={`py-2.5 px-4 font-semibold text-sm transition-all border-b-2 -mb-px ${
            activeTab === 'units'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          Major Units &amp; Allocations
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : activeTab === 'meters' ? (
        /* METERS MANAGEMENT TAB */
        <div className="space-y-4">
 

          {/* Separate Table Cards per Section */}
          {meters.length === 0 ? (
            <Card className="text-center py-16 text-text-muted">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 opacity-40">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              <p className="text-sm font-medium">No meters configured yet</p>
              <p className="text-xs mt-1">Add your first meter to get started</p>
            </Card>
          ) : sections.length > 0 ? (
            <div className="space-y-6">
              {sections.map((sec) => {
                const secMeters = meters.filter((m) => m.section_id === sec.id);

                const secIncomingMeters = sortMetersList(
                  secMeters.filter((m) => m.type === 'incoming' || m.type === 'main')
                );
                const secMotherMeters = sortMetersList(
                  secMeters.filter((m) => m.type === 'outgoing_main' || m.type === 'outgoing')
                );
                const secSubMeters = sortMetersList(
                  secMeters.filter((m) => m.type === 'outgoing_sub' || m.type === 'submeter')
                );
                const secSubSubMeters = sortMetersList(
                  secMeters.filter((m) => m.type === 'outgoing_sub_sub')
                );

                const getSecSubMetersForParent = (parentId: string) =>
                  secSubMeters.filter((m) => m.parent_meter_id === parentId);

                const getSecSubSubMetersForParent = (parentId: string) =>
                  secSubSubMeters.filter((m) => m.parent_meter_id === parentId);

                const secUnassignedSubMeters = secSubMeters.filter(
                  (m) => !m.parent_meter_id || !meterMap.has(m.parent_meter_id)
                );
                const secUnassignedSubSubMeters = secSubSubMeters.filter(
                  (m) => !m.parent_meter_id || !meterMap.has(m.parent_meter_id)
                );

                return (
                  <Card key={sec.id} className="p-0 overflow-hidden border border-border/80 shadow-sm">
                    {/* Section Header Bar */}
                    <div className="px-5 py-3.5 bg-bg-elevated border-b border-border flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xl">{sec.icon}</span>
                        <h2 className="text-base font-bold text-text-primary">{sec.name}</h2>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-accent/15 text-accent border border-accent/20">
                          {secMeters.length} {secMeters.length === 1 ? 'Meter' : 'Meters'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {secMeters.length > 0 && (
                          <div className="flex items-center gap-1 text-xs">
                            <button
                              type="button"
                              onClick={expandAllMeters}
                              className="px-2 py-1 rounded bg-bg-surface hover:bg-bg-surface-hover text-accent font-medium transition-colors border border-border/60"
                              title="Expand all rows"
                            >
                              ▼ Expand All
                            </button>
                            <button
                              type="button"
                              onClick={collapseAllMeters}
                              className="px-2 py-1 rounded bg-bg-surface hover:bg-bg-surface-hover text-text-secondary font-medium transition-colors border border-border/60"
                              title="Collapse all rows"
                            >
                              ► Collapse All
                            </button>
                          </div>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setMeterFormOpen(true)}
                          className="text-xs"
                        >
                          + Add Meter
                        </Button>
                      </div>
                    </div>

                    {/* Section Table Body */}
                    {secMeters.length === 0 ? (
                      <div className="text-center py-10 px-4 text-text-muted">
                        <p className="text-sm">No meters in {sec.name} section yet.</p>
                        <p className="text-xs mt-1 text-text-muted/70">
                          Click "+ Add Meter" to configure meters under this section.
                        </p>
                      </div>
                    ) : (
                      <div className="max-h-[60vh] overflow-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 z-10 bg-bg-elevated/60 backdrop-blur-sm">
                            <tr className="border-b border-border text-xs text-text-secondary">
                              <th className="px-4 py-2.5 text-left font-semibold">
                                <button
                                  type="button"
                                  onClick={() => handleSort('name')}
                                  className={`hover:text-accent transition-colors focus:outline-none ${sortField === 'name' ? 'text-accent font-bold' : ''}`}
                                >
                                  Meter Name
                                </button>
                              </th>
                              <th className="px-4 py-2.5 text-left font-semibold">
                                <button
                                  type="button"
                                  onClick={() => handleSort('category')}
                                  className={`hover:text-accent transition-colors focus:outline-none ${sortField === 'category' ? 'text-accent font-bold' : ''}`}
                                >
                                  Category
                                </button>
                              </th>
                              <th className="px-4 py-2.5 text-left font-semibold">
                                <button
                                  type="button"
                                  onClick={() => handleSort('location')}
                                  className={`hover:text-accent transition-colors focus:outline-none ${sortField === 'location' ? 'text-accent font-bold' : ''}`}
                                >
                                  Location
                                </button>
                              </th>
                              <th className="px-4 py-2.5 text-left font-semibold">
                                <button
                                  type="button"
                                  onClick={() => handleSort('parent')}
                                  className={`hover:text-accent transition-colors focus:outline-none ${sortField === 'parent' ? 'text-accent font-bold' : ''}`}
                                >
                                  Parent (Mother)
                                </button>
                              </th>
                              <th className="px-4 py-2.5 text-center font-semibold">
                                <button
                                  type="button"
                                  onClick={() => handleSort('mf')}
                                  className={`hover:text-accent transition-colors focus:outline-none ${sortField === 'mf' ? 'text-accent font-bold' : ''}`}
                                >
                                  M.F
                                </button>
                              </th>
                              <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* Incoming Meters */}
                            {secIncomingMeters.length > 0 && (
                              <>
                                <tr className="bg-warning/10 border-y border-warning/20">
                                  <td colSpan={6} className="px-4 py-2 font-bold text-warning text-xs uppercase tracking-wider">
                                    Incoming Meters ({secIncomingMeters.length})
                                  </td>
                                </tr>
                                {secIncomingMeters.map((m, idx) =>
                                  renderMeterRow(m, false, false, idx, secIncomingMeters.length, (dir) =>
                                    handleMoveMeterInList(secIncomingMeters, idx, dir)
                                  )
                                )}
                              </>
                            )}

                            {/* Outgoing Mother & Submeters */}
                            {(secMotherMeters.length > 0 || secSubMeters.length > 0) && (
                              <>
                                <tr className="bg-accent/10 border-y border-accent/20">
                                  <td colSpan={6} className="px-4 py-2 font-bold text-accent text-xs uppercase tracking-wider">
                                    Mother &amp; Submeter Hierarchy ({secMotherMeters.length + secSubMeters.length + secSubSubMeters.length})
                                  </td>
                                </tr>
                                {secMotherMeters.map((mother, idx) => {
                                  const children = getSecSubMetersForParent(mother.id);
                                  const isMotherCollapsed = collapsedMeterIds.has(mother.id);

                                  return (
                                    <React.Fragment key={mother.id}>
                                      {renderMeterRow(mother, false, false, idx, secMotherMeters.length, (dir) =>
                                        handleMoveMeterInList(secMotherMeters, idx, dir)
                                      )}
                                      {!isMotherCollapsed &&
                                        children.map((child, cIdx) => {
                                          const grandchildren = getSecSubSubMetersForParent(child.id);
                                          const isChildCollapsed = collapsedMeterIds.has(child.id);

                                          return (
                                            <React.Fragment key={child.id}>
                                              {renderMeterRow(child, true, false, cIdx, children.length, (dir) =>
                                                handleMoveMeterInList(children, cIdx, dir)
                                              )}
                                              {!isChildCollapsed &&
                                                grandchildren.map((gc, gcIdx) =>
                                                  renderMeterRow(gc, false, true, gcIdx, grandchildren.length, (dir) =>
                                                    handleMoveMeterInList(grandchildren, gcIdx, dir)
                                                  )
                                                )}
                                            </React.Fragment>
                                          );
                                        })}
                                    </React.Fragment>
                                  );
                                })}
                              </>
                            )}

                            {/* Unassigned Submeters */}
                            {secUnassignedSubMeters.length > 0 && (
                              <>
                                <tr className="bg-success/10 border-y border-success/20">
                                  <td colSpan={6} className="px-4 py-2 font-bold text-success text-xs uppercase tracking-wider">
                                    Unassigned Submeters ({secUnassignedSubMeters.length})
                                  </td>
                                </tr>
                                {secUnassignedSubMeters.map((m, idx) =>
                                  renderMeterRow(m, false, false, idx, secUnassignedSubMeters.length, (dir) =>
                                    handleMoveMeterInList(secUnassignedSubMeters, idx, dir)
                                  )
                                )}
                              </>
                            )}

                            {/* Unassigned Sub of Sub Meters */}
                            {secUnassignedSubSubMeters.length > 0 && (
                              <>
                                <tr className="bg-danger/10 border-y border-danger/20">
                                  <td colSpan={6} className="px-4 py-2 font-bold text-danger text-xs uppercase tracking-wider">
                                    Unassigned Sub of Sub ({secUnassignedSubSubMeters.length})
                                  </td>
                                </tr>
                                {secUnassignedSubSubMeters.map((m, idx) =>
                                  renderMeterRow(m, false, false, idx, secUnassignedSubSubMeters.length, (dir) =>
                                    handleMoveMeterInList(secUnassignedSubSubMeters, idx, dir)
                                  )
                                )}
                              </>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                );
              })}

              {/* Uncategorized Meters Card */}
              {meters.some((m) => !m.section_id) && (
                <Card className="p-0 overflow-hidden border border-border/80 shadow-sm">
                  <div className="px-5 py-3.5 bg-bg-elevated border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">📦</span>
                      <h2 className="text-base font-bold text-text-primary">Uncategorized Meters</h2>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-text-muted/15 text-text-secondary border border-border">
                        {meters.filter((m) => !m.section_id).length} Meters
                      </span>
                    </div>
                  </div>
                  <div className="max-h-[60vh] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-bg-elevated/60 backdrop-blur-sm">
                        <tr className="border-b border-border text-xs text-text-secondary">
                          <th className="px-4 py-2.5 text-left font-semibold">Meter Name</th>
                          <th className="px-4 py-2.5 text-left font-semibold">Category</th>
                          <th className="px-4 py-2.5 text-left font-semibold">Location</th>
                          <th className="px-4 py-2.5 text-left font-semibold">Parent (Mother)</th>
                          <th className="px-4 py-2.5 text-center font-semibold">M.F</th>
                          <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {meters.filter((m) => !m.section_id).map((m, idx) =>
                          renderMeterRow(m, false, false, idx)
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          ) : (
            /* Fallback single table when no sections are defined */
            <Card className="p-0 overflow-hidden">
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-bg-elevated/60 backdrop-blur-sm">
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left font-semibold text-text-secondary">Meter Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-text-secondary">Category</th>
                      <th className="px-4 py-3 text-left font-semibold text-text-secondary">Location</th>
                      <th className="px-4 py-3 text-left font-semibold text-text-secondary">Parent (Mother)</th>
                      <th className="px-4 py-3 text-center font-semibold text-text-secondary">M.F</th>
                      <th className="px-4 py-3 text-right font-semibold text-text-secondary">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomingMeters.map((m, idx) => renderMeterRow(m, false, false, idx))}
                    {motherMeters.map((m, idx) => renderMeterRow(m, false, false, idx))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Add Section Empty Table Placeholder */}
          <Card className="p-0 overflow-hidden border border-border/80 shadow-sm mt-4">
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-bg-elevated/60 backdrop-blur-sm">
                  <tr className="border-b border-border text-xs text-text-secondary">
                    <th className="px-4 py-2.5 text-left font-semibold">Meter Name</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Category</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Location</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Parent (Mother)</th>
                    <th className="px-4 py-2.5 text-center font-semibold">M.F</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-text-muted">
                      {!showSectionForm ? (
                        <div className="flex flex-col items-center justify-center">
                          <p className="text-sm font-medium mb-3">Organize meters by adding a new section</p>
                          <Button variant="outline" size="sm" onClick={() => setShowSectionForm(true)}>
                            + Add Section
                          </Button>
                        </div>
                      ) : (
                        <form onSubmit={handleAddSection} className="inline-flex flex-wrap items-center justify-center gap-3 bg-bg-elevated p-4 rounded-lg border border-border/50 shadow-sm">
                          <Input
                            placeholder="Section Name (e.g. Steam Meter)"
                            value={newSectionName}
                            onChange={(e) => setNewSectionName(e.target.value)}
                            className="w-56"
                          />
                          <Input
                            placeholder="Icon (e.g. 💨)"
                            value={newSectionIcon}
                            onChange={(e) => setNewSectionIcon(e.target.value)}
                            className="w-24"
                          />
                          <Input
                            placeholder="Unit (e.g. kWh)"
                            value={newSectionUnit}
                            onChange={(e) => setNewSectionUnit(e.target.value)}
                            className="w-32"
                          />
                          <Button type="submit" variant="primary" size="sm" loading={sectionCreating}>
                            Save
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setShowSectionForm(false)}>
                            Cancel
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : (
        /* MAJOR UNITS & ALLOCATIONS TAB */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Units List */}
          <div className="space-y-6">
            <Card>
              <h2 className="text-lg font-semibold text-text-primary mb-4">Major Units</h2>
              <form onSubmit={handleCreateUnit} className="flex gap-2 mb-4">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Add Unit (e.g. Spinning)"
                    value={newUnitName}
                    onChange={(e) => setNewUnitName(e.target.value)}
                    className="w-full h-10 px-3 py-1 rounded-[var(--radius-md)] border border-border bg-bg-primary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                  />
                </div>
                <Button type="submit" variant="primary" loading={unitCreating}>Add</Button>
              </form>

              {units.length === 0 ? (
                <p className="text-sm text-text-muted italic py-4">No units defined yet.</p>
              ) : (
                <div className="space-y-1">
                  {units.map((unit, idx) => (
                    <div
                      key={unit.id}
                      onClick={() => setSelectedUnitId(unit.id)}
                      className={`flex items-center justify-between p-2.5 rounded-[var(--radius-md)] cursor-pointer transition-all ${
                        selectedUnitId === unit.id
                          ? 'bg-accent/15 text-accent font-medium border border-accent/30'
                          : 'hover:bg-bg-surface-hover text-text-secondary border border-transparent'
                      }`}
                    >
                      <span className="text-sm">{unit.name}</span>
                      <div className="flex items-center gap-1.5">
                        <div className="flex items-center gap-0.5">
                          <button
                            disabled={idx === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveUnit(idx, 'up');
                            }}
                            className="text-text-muted hover:text-accent disabled:opacity-30 disabled:pointer-events-none p-1 rounded transition-colors"
                            title="Move Up"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <polyline points="18 15 12 9 6 15" />
                            </svg>
                          </button>
                          <button
                            disabled={idx === units.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveUnit(idx, 'down');
                            }}
                            className="text-text-muted hover:text-accent disabled:opacity-30 disabled:pointer-events-none p-1 rounded transition-colors"
                            title="Move Down"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </button>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteUnit(unit);
                          }}
                          className="text-text-muted hover:text-danger p-1 rounded transition-colors"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Allocation Matrix (Outgoing Meters Only) */}
          <div className="lg:col-span-2">
            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b border-border bg-bg-elevated flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-text-primary">Meter Allocation Matrix</h2>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {selectedUnit
                      ? `Define what percentage of each outgoing meter belongs to "${selectedUnit.name}"`
                      : 'Select a Major Unit from the left to configure allocations'}
                  </p>
                </div>
                {selectedUnitId && (
                  <Button variant="success" size="sm" loading={unitSaving} onClick={handleSaveAllocations}>
                    Save Changes
                  </Button>
                )}
              </div>

              {!selectedUnitId ? (
                <div className="text-center py-16 text-text-muted">
                  <p className="text-sm">Please select or add a unit first.</p>
                </div>
              ) : outgoingMetersOnly.length === 0 ? (
                <div className="text-center py-16 text-text-muted">
                  <p className="text-sm">No active outgoing meters configured.</p>
                </div>
              ) : (
                <div className="max-h-[60vh] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-bg-elevated/60 backdrop-blur-sm">
                      <tr className="border-b border-border text-text-secondary font-semibold">
                        <th className="px-4 py-3 text-left">Outgoing Meter Name</th>
                        <th className="px-4 py-3 text-left">Location</th>
                        <th className="px-4 py-3 text-center">Other Allocations</th>
                        <th className="px-4 py-3 text-center">Unallocated</th>
                        <th className="px-4 py-3 text-center w-[120px] text-accent">Allocation (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outgoingMetersOnly.map((meter, idx) => {
                        const localVal = localAllocations[meter.id] || '';
                        const otherPct = meterTotalAllocations[meter.id] || 0;
                        const localPct = parseFloat(localVal) || 0;
                        const totalPct = otherPct + localPct;
                        const isOver = totalPct > 100;

                        const treeAllocated = getTreeTotalAllocated(meter.id, localAllocations);
                        const unallocatedPct = Math.max(0, 100 - treeAllocated);

                        return (
                          <tr
                            key={meter.id}
                            className={`border-b border-border/50 transition-colors hover:bg-bg-surface-hover ${
                              idx % 2 === 0 ? 'bg-bg-surface' : 'bg-bg-primary/50'
                            }`}
                          >
                            <td className="px-4 py-3 font-medium text-text-primary">{meter.name}</td>
                            <td className="px-4 py-3 text-text-secondary">{meter.location}</td>
                            <td className="px-4 py-3 text-center tabular-nums">
                              {otherPct > 0 ? (
                                <span className="text-text-muted text-xs font-semibold">{otherPct}%</span>
                              ) : (
                                <span className="text-text-muted/40 text-xs">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center font-semibold tabular-nums">
                              <span className={unallocatedPct === 0 ? 'text-text-muted/50' : 'text-success'}>
                                {unallocatedPct}%
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  placeholder="0"
                                  value={localVal}
                                  onChange={(e) => handlePercentageChange(meter.id, e.target.value)}
                                  className={`w-16 h-8 text-center rounded border bg-bg-primary font-bold tabular-nums text-sm focus:outline-none focus:ring-2 transition-all ${
                                    isOver
                                      ? 'border-danger focus:ring-danger/50 text-danger'
                                      : localPct > 0
                                      ? 'border-accent focus:ring-accent/50 text-accent'
                                      : 'border-border focus:ring-accent/50 text-text-secondary'
                                  }`}
                                />
                                <span className="text-xs text-text-muted font-bold">%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Add Meter Modal */}
      <MeterForm
        open={meterFormOpen}
        onClose={() => setMeterFormOpen(false)}
        onSubmit={handleAddMeter}
        mainMeters={potentialParentMeters}
        allMeters={meters}
        sections={sections}
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
        loading={meterSubmitting}
      />
    </div>
  );
}
