<!-- src/components/ui/SliderField.vue -->
<!--
  Labeled range slider with a live value badge and min/max hints.

  Props:
    modelValue  (Number)  – v-model binding
    label       (String)  – field label text
    display     (String)  – formatted value shown in the badge (e.g. "2000 W")
    min, max, step (Number)
    hintMin     (String)  – left hint below slider
    hintMax     (String)  – right hint below slider

  Usage:
    <SliderField
      :label="t('control.power')"
      :display="`${watts} W`"
      v-model="watts"
      :min="500" :max="5000" :step="100"
      hint-min="500 W"
      hint-max="5000 W"
    />
-->
<template>
  <div class="slider-field">
    <div class="field__label-row">
      <span class="field__label">{{ label }}</span>
      <span class="field__value">{{ display }}</span>
    </div>
    <input
      type="range"
      class="range"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      @input="$emit('update:modelValue', Number($event.target.value))"
    />
    <div v-if="hintMin || hintMax" class="field__hints">
      <span>{{ hintMin }}</span>
      <span>{{ hintMax }}</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  modelValue: { type: Number, required: true },
  label:      { type: String, default: '' },
  display:    { type: String, default: '' },
  min:        { type: Number, default: 0 },
  max:        { type: Number, default: 100 },
  step:       { type: Number, default: 1 },
  hintMin:    { type: String, default: '' },
  hintMax:    { type: String, default: '' },
});

defineEmits(['update:modelValue']);
</script>

<style scoped>
.slider-field                 { display: flex; flex-direction: column; gap: 0.3rem; }
.field__label-row             { display: flex;justify-content: space-between;align-items: center;}
.field__label                 { font-size: 0.8rem;font-weight: 500;color: var(--color-secondary-500);}
.field__value                 { font-size: 0.8rem;font-weight: 600;color: var(--color-primary);background: var(--color-background);padding: 0.1rem 0.5rem;border: 1px solid var(--border-color);border-radius: 3px;min-width: 54px;text-align: center;font-variant-numeric: tabular-nums;}
.range {
  width: 100%;
  -webkit-appearance: none;
  appearance: none;
  height: 3px;
  border-radius: 2px;
  background: #d1d5db;
  outline: none;
  cursor: pointer;
}
.range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: #374151;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px #9ca3af;
  cursor: pointer;
}
.range::-moz-range-thumb {
  width: 14px; height: 14px;
  border-radius: 50%;
  background: #374151;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px #9ca3af;
  cursor: pointer;
}

.field__hints {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: #9ca3af;
}
</style>