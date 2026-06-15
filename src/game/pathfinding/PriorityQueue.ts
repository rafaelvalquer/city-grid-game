export type PriorityQueueEntry<T> = {
  value: T;
  priority: number;
};

/**
 * Binary min-heap priority queue.
 *
 * Used by A* pathfinding to avoid sorting the whole open set on every step.
 * push: O(log n)
 * pop: O(log n)
 * isEmpty/size: O(1)
 */
export class PriorityQueue<T> {
  private items: Array<PriorityQueueEntry<T> & { order: number }> = [];
  private nextOrder = 0;

  get size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  push(value: T, priority: number): void {
    this.items.push({ value, priority, order: this.nextOrder });
    this.nextOrder += 1;
    this.bubbleUp(this.items.length - 1);
  }

  pop(): PriorityQueueEntry<T> | undefined {
    const first = this.items[0];
    const last = this.items.pop();

    if (!first || !last) return undefined;

    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }

    return { value: first.value, priority: first.priority };
  }

  clear(): void {
    this.items = [];
    this.nextOrder = 0;
  }

  private hasHigherPriority(leftIndex: number, rightIndex: number): boolean {
    const left = this.items[leftIndex];
    const right = this.items[rightIndex];

    if (left.priority !== right.priority) {
      return left.priority < right.priority;
    }

    return left.order < right.order;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.hasHigherPriority(parent, index)) break;

      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  private sinkDown(index: number): void {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < this.items.length && this.hasHigherPriority(left, smallest)) {
        smallest = left;
      }

      if (right < this.items.length && this.hasHigherPriority(right, smallest)) {
        smallest = right;
      }

      if (smallest === index) return;

      [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
      index = smallest;
    }
  }
}
