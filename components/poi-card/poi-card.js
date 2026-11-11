Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    item: { type: Object, value: {} },
    editing: { type: Boolean, value: false }
  },

  methods: {
    onEdit() {
      this.triggerEvent('edit', { id: this.data.item._id })
    },

    onToggleFacts() {
      this.triggerEvent('togglefacts', { id: this.data.item._id })
    },

    onUp() {
      this.triggerEvent('up', { id: this.data.item._id })
    },

    onDown() {
      this.triggerEvent('down', { id: this.data.item._id })
    },

    onRemove() {
      this.triggerEvent('remove', { id: this.data.item._id })
    }
  }
})
