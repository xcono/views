<!-- CardBlock.svelte - shadcn-svelte Card component wrapper -->
<!-- Follows shadcn-svelte patterns and Svelte 5 runes -->

<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
  import { cn } from "$lib/utils.js";

  interface CardBlockProps {
    title?: string;
    items: unknown[];
    mapping?: Array<{
      key: string;
      label: string;
      type?: "title" | "subtitle" | "meta" | "content";
    }>;
    class?: string;
  }

  let { 
    title = "",
    items = [],
    mapping = [],
    class: className = ""
  }: CardBlockProps = $props();

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
      type: index === 0 ? "title" as const : "content" as const
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
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {#each items as item}
        {@const itemRecord = item as Record<string, unknown>}
        <Card.Root class="hover:shadow-md transition-shadow">
          <Card.Header>
            {#if getMappedValue(itemRecord, "title")}
              <Card.Title>
                {formatValue(getMappedValue(itemRecord, "title"))}
              </Card.Title>
            {/if}
            {#if getMappedValue(itemRecord, "subtitle")}
              <Card.Description>
                {formatValue(getMappedValue(itemRecord, "subtitle"))}
              </Card.Description>
            {/if}
          </Card.Header>
          
          {#if getMappedValue(itemRecord, "content")}
            <Card.Content>
              <p class="text-sm text-muted-foreground">
                {formatValue(getMappedValue(itemRecord, "content"))}
              </p>
            </Card.Content>
          {/if}
          
          {#if getMappedValue(itemRecord, "meta")}
            <Card.Footer>
              <p class="text-xs text-muted-foreground">
                {formatValue(getMappedValue(itemRecord, "meta"))}
              </p>
            </Card.Footer>
          {/if}
        </Card.Root>
      {/each}
    </div>
  {/if}
</div>
