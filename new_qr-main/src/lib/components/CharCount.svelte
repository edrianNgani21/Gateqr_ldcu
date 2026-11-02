<script lang="ts">
  import { MAX_REASON_LENGTH } from '$lib/limits';

  let { value = '', max = MAX_REASON_LENGTH }: { value?: string; max?: number } = $props();

  let length = $derived((value || '').length);
  let atLimit = $derived(length >= max);
</script>

<div class="char-count" class:at-limit={atLimit} aria-live="polite">
  {atLimit ? 'Character limit reached · ' : ''}{length}/{max}
</div>

<style>
  .char-count {
    margin-top: 0.25rem;
    font-size: 0.72rem;
    color: #6b7280;
    text-align: right;
  }

  .char-count.at-limit {
    color: #dc2626;
    font-weight: 600;
  }
</style>
