<script lang="ts">
  let {
    tabs,
    active,
    counts = [],
    labels = {},
    onchange
  }: {
    tabs: string[];
    active: string;
    counts?: number[];
    labels?: Record<string, string>;
    onchange: (tab: string) => void;
  } = $props();
</script>

<div class="tab-bar" role="tablist">
  {#each tabs as tab}
    <button
      role="tab"
      aria-selected={active === tab}
      class="tab-btn"
      class:tab-active={active === tab}
      onclick={() => onchange(tab)}
    >
      <span class="tab-label">{labels[tab] || tab}</span>
    </button>
  {/each}
</div>

<style>
  .tab-bar {
    display: flex;
    gap: 0.375rem;
    background: var(--maroon-tint);
    border: 1.5px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.3rem;
    flex-wrap: wrap;
  }

  .tab-btn {
    flex: 1 1 auto;
    min-width: 80px;
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 600;
    font-family: inherit;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.18s, color 0.18s, box-shadow 0.18s;
    text-transform: capitalize;
    letter-spacing: 0.01em;
    white-space: normal;
    text-align: center;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .tab-btn:hover:not(.tab-active) {
    background: rgba(107,26,42,0.07);
    color: var(--maroon);
  }

  .tab-active {
    background: var(--maroon) !important;
    color: #fff !important;
    box-shadow: 0 2px 8px rgba(107,26,42,0.3);
  }

  @media (max-width: 640px) {
    .tab-bar {
      overflow-x: auto;
      flex-wrap: nowrap;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      padding: 0.25rem;
      gap: 0.25rem;
    }
    .tab-bar::-webkit-scrollbar {
      display: none;
    }
    .tab-btn {
      flex: 0 0 auto;
      white-space: nowrap;
      padding: 0.45rem 0.75rem;
      font-size: 0.75rem;
      min-width: auto;
    }
  }

  @media (max-width: 360px) {
    .tab-btn {
      padding: 0.4rem 0.6rem;
      font-size: 0.7rem;
    }
  }
</style>
