# Calmd Context

Calmd is a calm note-taking experience where a person develops or retrieves a thought without being shown the size or structure of their collection.

## Language

**Thought**:
The idea or question the person is currently forming in the composer.
_Avoid_: Query, search term

**Composer**:
The primary surface where a person begins a thought and receives relevant existing notes.
_Avoid_: Command palette, search page

**Blank composer**:
The initial state before a thought is entered. It contains no retrieval results or collection information.
_Avoid_: Empty-state content, recent notes

**Retrieval**:
Finding existing notes that are relevant to the current thought. Retrieval helps the person engage with their notes rather than replacing them with generated content.
_Avoid_: AI answer, chat

**Note**:
A saved, standalone piece of knowledge whose title identifies it.
_Avoid_: Vault item, document

**Note title**:
The human-readable identity of a note. Titles are unique without regard to casing or surrounding or repeated whitespace; punctuation remains meaningful.
_Avoid_: Note ID

**Exact title match**:
An existing note whose title equals the current thought after title normalization. It takes precedence over creating a note.
_Avoid_: Related result

**Retrieval match**:
An existing note that is relevant to the current thought but does not have the same title. It does not prevent creating a new note.
_Avoid_: Exact match

**Title match**:
A retrieval match found through the note’s title. The result is represented by the note title.
_Avoid_: Content result

**Semantic match**:
A retrieval match found through related meaning without a literal matching phrase. The result is represented by the note title only.
_Avoid_: Generated answer

**Content match**:
A retrieval match found in the note’s content. The result shows the note title and the line containing the match when available.
_Avoid_: Title-only result

**Rename note**:
Changing a note’s title without creating a second note or changing the note’s content.
_Avoid_: Create replacement note

**Create note**:
The action that turns the current thought into a new note with that thought as its title and an initially empty body. A note with the same title must not be created twice; when an exact title match exists, opening it takes precedence.
_Avoid_: Add item, save search

**Existing note**:
A note that has already been created and can be opened from retrieval.
_Avoid_: Result item

**Internal link**:
A reference from one note to another note using `[[...]]`; the reference follows the target note when it is renamed.
_Avoid_: App-only link

**Backlink**:
An internal link from another note into the note currently being read. Backlinks stay hidden until explicitly requested.
_Avoid_: Related-notes panel
