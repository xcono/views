<!-- TableBlock.svelte - shadcn-svelte Table component wrapper -->
<!-- Follows shadcn-svelte patterns and Svelte 5 runes -->

<script lang="ts">
  import * as Table from "$lib/components/ui/table/index.js";
  import { cn } from "$lib/utils.js";

  interface TableBlockProps {
    title?: string;
    items: unknown[];
    mapping?: Array<{
      key: string;
      label: string;
      type?: "text" | "number" | "date" | "boolean";
    }>;
    class?: string;
  }

  let { 
    title = "",
    items = [],
    mapping = [],
    class: className = ""
  }: TableBlockProps = $props();

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
    
    return Object.keys(firstItem).map(key => ({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      type: "text" as const
    }));
  });

  // Format cell value based on type
  function formatCellValue(value: unknown, type: string = "text"): string {
    if (value === null || value === undefined) {
      return "";
    }
    
    switch (type) {
      case "number":
        return typeof value === "number" ? value.toString() : String(value);
      case "date":
        if (value instanceof Date) {
          return value.toLocaleDateString();
        }
        if (typeof value === "string") {
          const date = new Date(value);
          return isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
        }
        return String(value);
      case "boolean":
        return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
      default:
        return String(value);
    }
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
    <div class="rounded-md border">
      <Table.Root>
        <Table.Header>
          <Table.Row>
            {#each effectiveMapping as column}
              <Table.Head>{column.label}</Table.Head>
            {/each}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each items as item}
            {@const itemRecord = item as Record<string, unknown>}
            <Table.Row>
              {#each effectiveMapping as column}
                <Table.Cell>
                  {formatCellValue(itemRecord[column.key], column.type)}
                </Table.Cell>
              {/each}
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  {/if}
</div>
