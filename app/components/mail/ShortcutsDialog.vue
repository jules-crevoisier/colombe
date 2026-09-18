<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })
const groups = computed(() => (['Partout', 'Liste', 'Message'] as const).map(scope => ({ scope, items: SHORTCUTS.filter(s => s.scope === scope) })))
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Raccourcis clavier</DialogTitle>
        <DialogDescription>Inactifs pendant la saisie de texte.</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-5">
        <section v-for="g in groups" :key="g.scope">
          <h3 class="mb-2 text-sm font-medium text-muted-foreground">{{ g.scope }}</h3>
          <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
            <template v-for="s in g.items" :key="`${g.scope}-${s.keys}`">
              <dt>{{ s.label }}</dt>
              <dd><kbd class="rounded-md border bg-secondary px-2 py-0.5 font-mono text-xs">{{ s.keys }}</kbd></dd>
            </template>
          </dl>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>
