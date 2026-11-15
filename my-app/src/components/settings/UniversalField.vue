<template>
  <div v-if="field.visible !== false" class="flex flex-col gap-1.5 w-full">
  <label class="text-xs  text-secondary-500  tracking-wider ml-1">
      {{ field.label }}
      <span v-if="field.required" class="text-red-500 ml-1">*</span>
    </label>

    <div class="relative group">
      <template v-if="['text', 'password', 'email', 'number', 'url'].includes(field.component)">
        <div class="relative flex items-center">
          <div v-if="field.icon" class="absolute left-4 text-secondary-400 group-focus-within:text-blue-500 transition-colors">
            <i :class="['ph-light', field.icon]"></i>
          </div>

          <input
            :id="field.key"
            :type="field.component"
            :value="modelValue"
            @input="emit('update:modelValue', $event.target.value)"
            :placeholder="field.placeholder"
            :disabled="field.editable === false || disabled"
            :required="field.required"
            :min="field.validation?.min"
            :max="field.validation?.max"
            :step="field.validation?.step"
            class="w-full p-2 transition-all "
            :class="[field.icon ? 'pl-11' : 'pl-4', validationError ? 'border-red-500 ring-red-500/10' : '']"
          />
        </div>
      </template>

      <textarea
        v-else-if="field.component === 'textarea'"
        :id="field.key"
        :value="modelValue"
        @input="emit('update:modelValue', $event.target.value)"
        :placeholder="field.placeholder"
        :disabled="field.editable === false || disabled"
        rows="4"
        class="w-full bg-card  p-2 text-secondary-900 transition-all focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none disabled:bg-secondary-50"
      ></textarea>

      <select
        v-else-if="field.component === 'select' || field.component === 'dropdown'"
        :id="field.key"
        :value="modelValue"
        @change="emit('update:modelValue', $event.target.value)"
        :disabled="field.editable === false || disabled"
        class="w-full p-2 text-secondary-900 appearance-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
      >
        <option v-if="field.placeholder" value="" disabled selected>{{ field.placeholder }}</option>
        <option v-for="opt in field.options" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>

      <div v-else-if="['switch', 'boolean'].includes(field.component)">
        <div class="toggle-row">

          <button
            type="button"
            class="toggle"
            :class="{ 'toggle--on': !!modelValue }"
            :disabled="field.editable === false || disabled"
            @click="emit('update:modelValue', !modelValue)"
          >
            <span class="toggle__knob" />
          </button>

        </div>
      </div>
      <div v-else-if="field.component === 'color'" class="flex items-center gap-3 p-2  border border-secondary-400 ">
        <input 
          type="color" 
          :value="modelValue" 
          @input="emit('update:modelValue', $event.target.value)"
          class="h-10 w-20 rounded cursor-pointer border-none bg-transparent"
        />
        <span class="text-sm font-mono text-secondary-600 uppercase">{{ modelValue }}</span>
      </div>

      <div v-if="field.description && field.component !== 'switch'" class="mt-1.5 px-1">
        <p class="text-xs text-secondary-400 italic">
          
          {{ field.description }}
        </p>
      </div>

      <div v-if="validationError" class="mt-1 px-1 flex items-center gap-1.5 text-red-600">
        <i class="ph-light ph-triangle-exclamation text-[10px]"></i>
        <small class="text-[11px] font-bold tracking-wide uppercase">{{ validationError }}</small>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  field:            { type: Object, required: true },
  modelValue:       { type: [String, Number, Boolean, Array, Object], default: null },
  disabled:         { type: Boolean, default: false },
  validationError:  { type: String, default: null }
});

const emit = defineEmits(['update:modelValue']);
</script>

<style scoped>
/* Remove default arrow for custom styled select if needed */
select {
  background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
  background-position: right 0.75rem center;
  background-repeat: no-repeat;
  background-size: 1.5em 1.5em;
  padding-right: 2.5rem;
}
</style>