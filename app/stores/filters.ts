import { defineStore } from 'pinia'
import type { FilterRule } from '#shared/types/mail'

/** Pré-remplissage de la boîte « Nouveau filtre » (depuis la recherche ou la lecture d'un message). */
export interface FilterDialogPrefill {
  from?: string
  to?: string
  subject?: string
  /** « Contient les mots » (condition sur le corps), ex. depuis une recherche plein texte. */
  containsWords?: string
}

/**
 * État partagé de la boîte de dialogue « Nouveau filtre » / « Modifier le
 * filtre » (docs/dev/PLAN-v4.md F.2), montée une fois dans app.vue
 * (<FiltersFilterDialog />) et pilotée depuis n'importe quel point d'entrée :
 * Paramètres → Filtres, panneau de recherche, lecture d'un message.
 */
export const useFiltersStore = defineStore('filters', {
  state: () => ({
    dialogOpen: false,
    /** null : création. */
    editingRule: null as FilterRule | null,
    prefill: null as FilterDialogPrefill | null,
    /** Incrémenté à chaque enregistrement réussi : les listes qui l'observent se rechargent. */
    savedTick: 0,
  }),

  actions: {
    openCreate(prefill?: FilterDialogPrefill) {
      this.editingRule = null
      this.prefill = prefill ?? null
      this.dialogOpen = true
    },
    openEdit(rule: FilterRule) {
      this.editingRule = rule
      this.prefill = null
      this.dialogOpen = true
    },
    close() {
      this.dialogOpen = false
      this.editingRule = null
      this.prefill = null
    },
    notifySaved() {
      this.savedTick++
    },
  },
})
