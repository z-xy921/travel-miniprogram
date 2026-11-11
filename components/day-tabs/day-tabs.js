Component({
  properties: {
    tabs: { type: Array, value: [] },
    active: { type: Number, value: 0 }
  },

  methods: {
    onTap(e) {
      const index = Number(e.currentTarget.dataset.index)
      if (!isFinite(index) || index === this.data.active) return
      this.triggerEvent('change', { index: index })
    }
  }
})
