<!-- ListBlock.svelte - Simple list component using shadcn-svelte patterns -->
<!-- Follows shadcn-svelte patterns and Svelte 5 runes -->

<script lang="ts">
  import { cn } from "$lib/utils.js";

  interface ListBlockProps {
    title?: string;
    items: unknown[];
    mapping?: Array<{
      key: string;
      label: string;
      type?: "primary" | "secondary" | "meta";
    }>;
    class?: string;
  }

  let { 
    title = "",
    items = [],
    mapping = [],
    class: className = ""
  }: ListBlockProps = $props();

  // Auto-generate mapping from first item if not provided
  const effectiveMapping = $derived.by(() => {
    if (mapping.length > 0) {
      return mapping;
    }
    
    if (items.length === 0) {
      return [];
    }
    
    const firstItem = items[0];
    if (typeof firstItem !== "object" || firstItem === null) {
      return [];
    }
    
    const keys = Object.keys(firstItem);
    return keys.map((key, index) => ({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      type: index === 0 ? "primary" as const : "secondary" as const
    }));
  });

  // Get mapped values by type
  const getMappedValue = (item: Record<string, unknown>, type: string): unknown => {
    const mappingItem = effectiveMapping.find((m: any) => m.type === type);
    if (!mappingItem) return null;
    return item[mappingItem.key];
  };

  // Format cell value
  function formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }
    return String(value);
  }
</script>

<div class={cn("space-y-4", className)}>
  {#if title}
    <h3 class="text-lg font-semibold">{title}</h3>
  {/if}
  
  {#if items.length === 0}
    <div class="text-center py-8 text-muted-foreground">
      No data available
    </div>
  {:else}
    <div class="space-y-2">
      {#each items as item}
        {@const itemRecord = item as Record<string, unknown>}
        <div class="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
          <div class="space-y-1">
            {#if getMappedValue(itemRecord, "primary")}
              <div class="font-medium">
                {formatValue(getMappedValue(itemRecord, "primary"))}
              </div>
            {/if}
            {#if getMappedValue(itemRecord, "secondary")}
              <div class="text-sm text-muted-foreground">
                {formatValue(getMappedValue(itemRecord, "secondary"))}
              </div>
            {/if}
          </div>
          
          {#if getMappedValue(itemRecord, "meta")}
            <div class="text-sm text-muted-foreground">
              {formatValue(getMappedValue(itemRecord, "meta"))}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
