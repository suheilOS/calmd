type TextEdit = {
  from: number
  to: number
  insert: string
}

// Bound the LCS matrix so unusually large or divergent bodies fail safely into
// conflict handling instead of causing unbounded work on the editor thread.
const MAX_DIFF_CELLS = 4_000_000

function textEdits(base: string, changed: string): TextEdit[] | null {
  if (base === changed) return []

  let prefix = 0
  while (prefix < base.length
    && prefix < changed.length
    && base[prefix] === changed[prefix]) prefix += 1

  let suffix = 0
  while (suffix < base.length - prefix
    && suffix < changed.length - prefix
    && base[base.length - 1 - suffix] === changed[changed.length - 1 - suffix]) {
    suffix += 1
  }

  const source = base.slice(prefix, base.length - suffix)
  const target = changed.slice(prefix, changed.length - suffix)
  if (!source || !target) {
    return [{ from: prefix, to: prefix + source.length, insert: target }]
  }

  const columns = target.length + 1
  const cells = (source.length + 1) * columns
  if (cells > MAX_DIFF_CELLS) return null

  const commonLengths = new Uint32Array(cells)
  for (let sourceIndex = source.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
    for (let targetIndex = target.length - 1; targetIndex >= 0; targetIndex -= 1) {
      const index = sourceIndex * columns + targetIndex
      commonLengths[index] = source[sourceIndex] === target[targetIndex]
        ? commonLengths[(sourceIndex + 1) * columns + targetIndex + 1] + 1
        : Math.max(
          commonLengths[(sourceIndex + 1) * columns + targetIndex],
          commonLengths[index + 1],
        )
    }
  }

  const edits: TextEdit[] = []
  let sourceIndex = 0
  let targetIndex = 0
  while (sourceIndex < source.length || targetIndex < target.length) {
    if (sourceIndex < source.length
      && targetIndex < target.length
      && source[sourceIndex] === target[targetIndex]) {
      sourceIndex += 1
      targetIndex += 1
      continue
    }

    const from = sourceIndex
    let insert = ''
    while (sourceIndex < source.length || targetIndex < target.length) {
      if (sourceIndex < source.length
        && targetIndex < target.length
        && source[sourceIndex] === target[targetIndex]) break

      const deleteScore = sourceIndex < source.length
        ? commonLengths[(sourceIndex + 1) * columns + targetIndex]
        : -1
      const insertScore = targetIndex < target.length
        ? commonLengths[sourceIndex * columns + targetIndex + 1]
        : -1
      if (targetIndex < target.length && insertScore >= deleteScore) {
        insert += target[targetIndex]
        targetIndex += 1
      } else {
        sourceIndex += 1
      }
    }
    edits.push({ from: prefix + from, to: prefix + sourceIndex, insert })
  }
  return edits
}

function editsOverlap(left: TextEdit, right: TextEdit) {
  if (left.from === right.from && left.to === right.to && left.insert === right.insert) {
    return false
  }
  if (left.from === left.to && right.from === right.to) return left.from === right.from
  if (left.from === left.to) return left.from > right.from && left.from < right.to
  if (right.from === right.to) return right.from > left.from && right.from < left.to
  return left.from < right.to && right.from < left.to
}

export function mergeConcurrentTextChanges(
  base: string,
  canonical: string,
  current: string,
) {
  if (current === base) return canonical
  if (canonical === base || current === canonical) return current

  const canonicalEdits = textEdits(base, canonical)
  const currentEdits = textEdits(base, current)
  if (!canonicalEdits || !currentEdits) return null
  if (canonicalEdits.some((canonicalEdit) =>
    currentEdits.some((currentEdit) => editsOverlap(canonicalEdit, currentEdit)))) {
    return null
  }

  const edits = [...canonicalEdits]
  for (const currentEdit of currentEdits) {
    if (!edits.some((edit) => edit.from === currentEdit.from
      && edit.to === currentEdit.to
      && edit.insert === currentEdit.insert)) edits.push(currentEdit)
  }
  edits.sort((left, right) => left.from - right.from || (left.to - left.from) - (right.to - right.from))

  let merged = base
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index]
    merged = merged.slice(0, edit.from) + edit.insert + merged.slice(edit.to)
  }
  return merged
}
