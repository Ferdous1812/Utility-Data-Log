'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CustomTierLabels } from '@/lib/types';
import { DEFAULT_TIER_LABELS } from '@/lib/types';

const STORAGE_KEY = 'utility_tier_labels';

/**
 * Hook to load the custom meter tier labels from localStorage.
 * These labels are saved from the Settings page "Edit Category" modal
 * and should be used across all pages (log-reading, history, dashboard, etc.)
 * to display meter categories consistently.
 */
export function useTierLabels(): CustomTierLabels {
  const [tierLabels, setTierLabels] = useState<CustomTierLabels>(DEFAULT_TIER_LABELS);

  const loadLabels = useCallback(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setTierLabels({ ...DEFAULT_TIER_LABELS, ...parsed });
      } else {
        setTierLabels(DEFAULT_TIER_LABELS);
      }
    } catch (_e) {
      // localStorage unavailable or corrupted — use defaults
    }
  }, []);

  useEffect(() => {
    loadLabels();

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || !e.key) {
        loadLabels();
      }
    };

    const handleCustomEvent = () => {
      loadLabels();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('utility_tier_labels_changed', handleCustomEvent);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('utility_tier_labels_changed', handleCustomEvent);
    };
  }, [loadLabels]);

  return tierLabels;
}

/**
 * Get the display label for a meter type in the energy hierarchy.
 * Uses the custom tier labels saved from Settings.
 */
export function getEnergyTierLabel(
  meterType: string,
  labels: CustomTierLabels
): string {
  switch (meterType) {
    case 'incoming':
    case 'main':
      return labels.incoming || DEFAULT_TIER_LABELS.incoming;
    case 'outgoing_main':
    case 'outgoing':
      return labels.outgoing_main || DEFAULT_TIER_LABELS.outgoing_main;
    case 'outgoing_sub':
    case 'submeter':
      return labels.outgoing_sub || DEFAULT_TIER_LABELS.outgoing_sub;
    case 'outgoing_sub_sub':
      return labels.outgoing_sub_sub || DEFAULT_TIER_LABELS.outgoing_sub_sub;
    default:
      return meterType;
  }
}

/**
 * Get the display label for a meter type in the gas hierarchy.
 * Uses the custom tier labels saved from Settings.
 */
export function getGasTierLabel(
  meterType: string,
  labels: CustomTierLabels
): string {
  switch (meterType) {
    case 'incoming':
    case 'main':
      return labels.gas_incoming || DEFAULT_TIER_LABELS.gas_incoming;
    case 'outgoing_main':
    case 'outgoing':
      return labels.gas_outgoing_main || DEFAULT_TIER_LABELS.gas_outgoing_main;
    case 'outgoing_sub':
    case 'submeter':
      return labels.gas_outgoing_sub || DEFAULT_TIER_LABELS.gas_outgoing_sub;
    case 'outgoing_sub_sub':
      return labels.gas_outgoing_sub_sub || DEFAULT_TIER_LABELS.gas_outgoing_sub_sub;
    default:
      return meterType;
  }
}

/**
 * Get the group label for energy meter groups (used in table section headers).
 * Maps from meter type group to the configured tier name + plural descriptor.
 */
export function getEnergyGroupLabel(
  group: 'incoming' | 'outgoing_main' | 'outgoing_sub' | 'outgoing_sub_sub',
  labels: CustomTierLabels
): string {
  switch (group) {
    case 'incoming':
      return `${labels.incoming || DEFAULT_TIER_LABELS.incoming}s`;
    case 'outgoing_main':
      return `${labels.outgoing_main || DEFAULT_TIER_LABELS.outgoing_main}s`;
    case 'outgoing_sub':
      return `${labels.outgoing_sub || DEFAULT_TIER_LABELS.outgoing_sub}s`;
    case 'outgoing_sub_sub':
      return `${labels.outgoing_sub_sub || DEFAULT_TIER_LABELS.outgoing_sub_sub}s`;
  }
}

/**
 * Get the group label for gas meter groups.
 */
export function getGasGroupLabel(
  group: 'incoming' | 'outgoing_main' | 'outgoing_sub' | 'outgoing_sub_sub',
  labels: CustomTierLabels
): string {
  switch (group) {
    case 'incoming':
      return `${labels.gas_incoming || DEFAULT_TIER_LABELS.gas_incoming}s`;
    case 'outgoing_main':
      return `${labels.gas_outgoing_main || DEFAULT_TIER_LABELS.gas_outgoing_main}s`;
    case 'outgoing_sub':
      return `${labels.gas_outgoing_sub || DEFAULT_TIER_LABELS.gas_outgoing_sub}s`;
    case 'outgoing_sub_sub':
      return `${labels.gas_outgoing_sub_sub || DEFAULT_TIER_LABELS.gas_outgoing_sub_sub}s`;
  }
}

/**
 * Get hour meter group labels.
 */
export function getHourGroupLabels(labels: CustomTierLabels) {
  return {
    compressor: labels.hour_compressor || DEFAULT_TIER_LABELS.hour_compressor,
    pump: labels.hour_pump || DEFAULT_TIER_LABELS.hour_pump,
    generator: labels.hour_generator || DEFAULT_TIER_LABELS.hour_generator,
    other: labels.hour_other || DEFAULT_TIER_LABELS.hour_other,
  };
}

export type HourEquipmentGroup = 'Compressor' | 'Pump' | 'Generator' | 'Other';

/**
 * Determine the Hour meter equipment group ('Compressor' | 'Pump' | 'Generator' | 'Other')
 * from a meter object or string.
 */
export function getHourGroupKey(meter: any): HourEquipmentGroup {
  if (!meter) return 'Other';
  if (typeof meter === 'string') {
    const s = meter.toLowerCase();
    if (s.includes('compressor') || s.includes('comp')) return 'Compressor';
    if (s.includes('pump')) return 'Pump';
    if (s.includes('generator') || s.includes('gen') || s.includes('dg')) return 'Generator';
    return 'Other';
  }

  // 1. Check equipment_group directly
  const rawGroup = (meter.equipment_group || '').toString().trim();
  if (rawGroup) {
    const lower = rawGroup.toLowerCase();
    if (lower === 'compressor' || lower.includes('compressor')) return 'Compressor';
    if (lower === 'pump' || lower.includes('pump')) return 'Pump';
    if (lower === 'generator' || lower.includes('generator') || lower.includes('gen')) return 'Generator';
    if (lower === 'other') return 'Other';
  }

  // 2. Check category
  const cat = (meter.category || '').toString().toLowerCase();
  if (cat.includes('compressor') || cat.includes('comp')) return 'Compressor';
  if (cat.includes('pump')) return 'Pump';
  if (cat.includes('generator') || cat.includes('gen') || cat.includes('dg')) return 'Generator';

  // 3. Check meter name
  const name = (meter.name || '').toString().toLowerCase();
  if (name.includes('compressor') || name.includes('comp') || name.includes('atlas') || name.includes('screw')) return 'Compressor';
  if (name.includes('pump') || name.includes('booster') || name.includes('submersible') || name.includes('water')) return 'Pump';
  if (name.includes('generator') || name.includes('gen') || name.includes('dg') || name.includes('genset') || name.includes('gas eng') || name.includes('caterpillar') || name.includes('cummins') || name.includes('jenbacher')) return 'Generator';

  return 'Other';
}

/**
 * Get the customized display label for an hour meter equipment group.
 */
export function getHourMeterTierLabel(
  meter: any,
  labels: CustomTierLabels
): string {
  const group = getHourGroupKey(meter);
  switch (group) {
    case 'Compressor':
      return labels.hour_compressor || DEFAULT_TIER_LABELS.hour_compressor;
    case 'Pump':
      return labels.hour_pump || DEFAULT_TIER_LABELS.hour_pump;
    case 'Generator':
      return labels.hour_generator || DEFAULT_TIER_LABELS.hour_generator;
    case 'Other':
    default:
      return labels.hour_other || DEFAULT_TIER_LABELS.hour_other;
  }
}

/**
 * Helper: Determine the domain (energy/gas/hour) from a MeterSection.
 */
export function getSectionDomain(section?: { name?: string; unit?: string } | null): 'energy' | 'gas' | 'hour' {
  if (!section) return 'energy';
  const name = (section.name || '').toLowerCase();
  const unit = (section.unit || '').toLowerCase();
  if (name.includes('hour') || unit === 'hrs' || unit === 'hr' || unit.includes('hour')) return 'hour';
  if (name.includes('gas') || name.includes('rms') || unit === 'm³' || unit === 'm3' || unit.includes('m3') || unit.includes('m³')) return 'gas';
  return 'energy';
}

/**
 * Get the appropriate tier label based on meter and domain (energy/gas/hour).
 */
export function getMeterTierLabel(
  meterOrType: any,
  domain: 'energy' | 'gas' | 'hour',
  labels: CustomTierLabels
): string {
  if (domain === 'hour') {
    return getHourMeterTierLabel(meterOrType, labels);
  }
  const type = typeof meterOrType === 'string' ? meterOrType : meterOrType?.type || '';
  if (domain === 'gas') return getGasTierLabel(type, labels);
  return getEnergyTierLabel(type, labels);
}
