import sqlite3
import json
import uuid
import re

def _make_safe_name(name):
    """Converts a user-supplied field name to a valid SQLite column identifier."""
    # Replace spaces with underscores, strip non-alphanumeric characters, lowercase it
    safe = re.sub(r'[^a-z0-9_]', '', name.replace(' ', '_').lower())
    # Ensure it doesn't start with a digit
    if safe and safe[0].isdigit():
        safe = 'f_' + safe
    return safe or 'field'


DB_NAME = "tracker.db"

def get_db_connection():
    """Connects to the SQLite database and returns a connection object."""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """
    Initializes the core collections table.
    This table stores the metadata for dynamically generated 'Notion' databases.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Core table tracking all user-created databases
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS collections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            table_name TEXT NOT NULL UNIQUE,
            schema_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            parent_collection_id TEXT,
            parent_item_id TEXT
        )
    ''')
    
    # Run a dynamic migration on startup to ensure all existing databases have Recurrence AND Parent modifications
    existing_tables = cursor.execute('SELECT table_name FROM collections').fetchall()
    
    try:
        cursor.execute("ALTER TABLE collections ADD COLUMN parent_collection_id TEXT")
        cursor.execute("ALTER TABLE collections ADD COLUMN parent_item_id TEXT")
    except sqlite3.OperationalError:
        pass
    
    # Define columns to ensure backwards compatibility
    new_cols = [
        ("recurrence_rule", "TEXT DEFAULT 'NONE'"),
        ("recurrence_end_date", "TEXT"),
        ("recurrence_days", "TEXT"),
        ("end_date_time", "TEXT"),
        ("is_all_day", "INTEGER DEFAULT 0")
    ]
    
    for table_row in existing_tables:
        tname = table_row['table_name']
        for col_name, col_def in new_cols:
            try:
                cursor.execute(f"ALTER TABLE {tname} ADD COLUMN {col_name} {col_def}")
            except sqlite3.OperationalError:
                # Column likely already exists, ignore
                pass
            
    conn.commit()
    conn.close()

def create_collection(name, fields, summary_formulas=None, parent_collection_id=None, parent_item_id=None):
    """
    Dynamically creates a new tracking table.
    fields is a list of dicts: [{'name': 'Author', 'type': 'Text', 'target_collection_id': 'uuid...'}, ...]
    summary_formulas is an optional list of dicts: [{'name': 'Total Count', 'expression': 'len(rows)'}]
    """
    collection_id = str(uuid.uuid4())
    table_name = "dyn_" + collection_id.replace('-', '_')
    
    columns_sql = ["id INTEGER PRIMARY KEY AUTOINCREMENT"]
    
    for field in fields:
        field_name = _make_safe_name(field['name'])
        field_type = field['type']
        
        # Formulas are computed dynamically on read, so no physical column
        if field_type == 'Formula':
            continue
            
        sqlite_type = "TEXT" 
        if field_type == 'Number':
            sqlite_type = "REAL"
        elif field_type == 'DateTime':
            sqlite_type = "TEXT" # ISO 8601 strings
        elif field_type == 'Relation':
            sqlite_type = "INTEGER" # Store ID of target item
            
        columns_sql.append(f"{field_name} {sqlite_type}")
        
    columns_sql.append("created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    columns_sql.append("recurrence_rule TEXT DEFAULT 'NONE'")
    columns_sql.append("recurrence_end_date TEXT")
    columns_sql.append("recurrence_days TEXT")
    columns_sql.append("end_date_time TEXT")
    columns_sql.append("is_all_day INTEGER DEFAULT 0")
    
    create_table_query = f"CREATE TABLE IF NOT EXISTS {table_name} (\n"
    create_table_query += ",\n".join(columns_sql)
    create_table_query += "\n)"
    
    # Store schema metadata so frontend knows how to render the UI
    schema_metadata = {
        'fields': [
            {
                'name': f['name'], 
                'safe_name': _make_safe_name(f['name']), 
                'type': f['type'],
                'target_collection_id': f.get('target_collection_id'),
                'expression': f.get('expression')
            } for f in fields
        ],
        'summary_formulas': summary_formulas or []
    }

    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Create the physical SQLite table
    cursor.execute(create_table_query)
        
    # 2. Register the table in our collections metadata
    cursor.execute(
        'INSERT INTO collections (id, name, table_name, schema_json, parent_collection_id, parent_item_id) VALUES (?, ?, ?, ?, ?, ?)',
        (collection_id, name, table_name, json.dumps(schema_metadata), parent_collection_id, parent_item_id)
    )
    
    conn.commit()
    conn.close()
    
    return collection_id

def _enrich_with_parent_titles(conn, collections_list):
    """Adds 'parent_item_title' to collection dictionaries if applicable."""
    for cdict in collections_list:
        if cdict.get('parent_collection_id') and cdict.get('parent_item_id'):
            p_coll = conn.execute('SELECT table_name, schema_json FROM collections WHERE id = ?', (cdict['parent_collection_id'],)).fetchone()
            if p_coll:
                p_schema = json.loads(p_coll['schema_json'])
                title_field = p_schema['fields'][0]['safe_name'] if p_schema.get('fields') else None
                if title_field:
                    try:
                        p_item = conn.execute(f"SELECT {title_field} FROM {p_coll['table_name']} WHERE id = ?", (cdict['parent_item_id'],)).fetchone()
                        if p_item:
                            cdict['parent_item_title'] = p_item[title_field]
                    except Exception:
                        pass
    return collections_list

def get_collections():
    """Returns all created databases."""
    conn = get_db_connection()
    collections = conn.execute('SELECT * FROM collections ORDER BY created_at DESC').fetchall()
    
    result = []
    for c in collections:
        cdict = dict(c)
        cdict['schema'] = json.loads(cdict['schema_json'])
        del cdict['schema_json']
        result.append(cdict)
        
    result = _enrich_with_parent_titles(conn, result)
    conn.close()
    return result

def get_nested_collections(parent_item_id):
    """Returns databases nested within a specific item."""
    conn = get_db_connection()
    collections = conn.execute('SELECT * FROM collections WHERE parent_item_id = ? ORDER BY created_at DESC', (str(parent_item_id),)).fetchall()
    
    result = []
    for c in collections:
        cdict = dict(c)
        cdict['schema'] = json.loads(cdict['schema_json'])
        del cdict['schema_json']
        result.append(cdict)
        
    result = _enrich_with_parent_titles(conn, result)
    conn.close()
    return result

def add_formula_to_collection(collection_id, formula_data, is_summary=False):
    """Appends a new formula directly to a collection's schema metadata."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    coll = cursor.execute('SELECT schema_json FROM collections WHERE id = ?', (collection_id,)).fetchone()
    if not coll:
        conn.close()
        return False
        
    schema = json.loads(coll['schema_json'])
    
    if is_summary:
        if 'summary_formulas' not in schema:
            schema['summary_formulas'] = []
        schema['summary_formulas'].append({
            'name': formula_data['name'],
            'expression': formula_data['expression']
        })
    else:
        schema['fields'].append({
            'name': formula_data['name'],
            'safe_name': formula_data['name'].replace(' ', '_').lower(),
            'type': 'Formula',
            'expression': formula_data['expression']
        })
        
    cursor.execute('UPDATE collections SET schema_json = ? WHERE id = ?', (json.dumps(schema), collection_id))
    conn.commit()
    conn.close()
    return True

def update_formula_in_collection(collection_id, old_name, new_data, is_summary=False):
    """Updates a formula's name and expression dynamically."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    coll = cursor.execute('SELECT schema_json FROM collections WHERE id = ?', (collection_id,)).fetchone()
    if not coll:
        conn.close()
        return False
        
    schema = json.loads(coll['schema_json'])
    updated = False
    
    if is_summary:
        for f in schema.get('summary_formulas', []):
            if f.get('name') == old_name:
                f['name'] = new_data['name']
                f['expression'] = new_data['expression']
                updated = True
                break
    else:
        for f in schema.get('fields', []):
            if f.get('type') == 'Formula' and f.get('name') == old_name:
                f['name'] = new_data['name']
                f['safe_name'] = new_data['name'].replace(' ', '_').lower()
                f['expression'] = new_data['expression']
                updated = True
                break
                
    if updated:
        cursor.execute('UPDATE collections SET schema_json = ? WHERE id = ?', (json.dumps(schema), collection_id))
        conn.commit()
        
    conn.close()
    return updated

def delete_formula_from_collection(collection_id, formula_name, is_summary=False):
    """Deletes a formula from a collection."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    coll = cursor.execute('SELECT schema_json FROM collections WHERE id = ?', (collection_id,)).fetchone()
    if not coll:
        conn.close()
        return False
        
    schema = json.loads(coll['schema_json'])
    initial_len = 0
    
    if is_summary:
        if 'summary_formulas' in schema:
            initial_len = len(schema['summary_formulas'])
            schema['summary_formulas'] = [f for f in schema['summary_formulas'] if f.get('name') != formula_name]
            updated = len(schema['summary_formulas']) < initial_len
        else:
            updated = False
    else:
        if 'fields' in schema:
            initial_len = len(schema['fields'])
            schema['fields'] = [f for f in schema['fields'] if not (f.get('type') == 'Formula' and f.get('name') == formula_name)]
            updated = len(schema['fields']) < initial_len
        else:
            updated = False
            
    if updated:
        cursor.execute('UPDATE collections SET schema_json = ? WHERE id = ?', (json.dumps(schema), collection_id))
        conn.commit()
        
    conn.close()
    return updated

def rename_collection(collection_id, new_name):
    """Updates the name of an existing collection."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE collections SET name = ? WHERE id = ?", (new_name, collection_id))
        conn.commit()
    except Exception as e:
        print(f"Error renaming collection: {e}")
        return False
    finally:
        conn.close()
    return True

# --- Column/Field Operations ---

def add_field_to_collection(collection_id, field_data):
    """Adds a standard physical column to an existing collection."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    coll = cursor.execute('SELECT table_name, schema_json FROM collections WHERE id = ?', (collection_id,)).fetchone()
    if not coll:
        conn.close()
        return False
        
    table_name = coll['table_name']
    schema = json.loads(coll['schema_json'])
    
    safe_name = _make_safe_name(field_data['name'])
    field_type = field_data['type']
    
    # Check if exists
    if any(f.get('safe_name') == safe_name for f in schema.get('fields', [])):
        conn.close()
        return False
        
    # Formulas are logical fields, they don't need a physical column
    if field_type != 'Formula':
        # Determine SQLite type constraint
        sqlite_type = "TEXT"
        if field_type == 'Number': sqlite_type = "REAL"
        elif field_type == 'DateTime': sqlite_type = "TEXT"
        elif field_type == 'Relation': sqlite_type = "TEXT"
            
        # Physical Table Alter
        try:
            cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {safe_name} {sqlite_type}")
        except Exception as e:
            print(f"Error altering table {table_name}: {e}")
            conn.close()
            return False
        
    # Schema Metadata Update
    schema['fields'].append({
        'name': field_data['name'],
        'safe_name': safe_name,
        'type': field_type,
        'target_collection_id': field_data.get('target_collection_id') if field_type == 'Relation' else None,
        'expression': field_data.get('expression', '')
    })
    
    cursor.execute('UPDATE collections SET schema_json = ? WHERE id = ?', (json.dumps(schema), collection_id))
    conn.commit()
    conn.close()
    return True

def update_field_in_collection(collection_id, old_safe_name, new_name, expression=None):
    """Updates the display name or expression of a column/formula."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    coll = cursor.execute('SELECT schema_json FROM collections WHERE id = ?', (collection_id,)).fetchone()
    if not coll:
        conn.close()
        return False
        
    schema = json.loads(coll['schema_json'])
    updated = False
    
    for f in schema.get('fields', []):
        if f.get('safe_name') == old_safe_name:
            f['name'] = new_name
            if f.get('type') == 'Formula' and expression is not None:
                f['expression'] = expression
            updated = True
            break
            
    if updated:
        cursor.execute('UPDATE collections SET schema_json = ? WHERE id = ?', (json.dumps(schema), collection_id))
        conn.commit()
        
    conn.close()
    return updated

def delete_field_from_collection(collection_id, safe_name):
    """Drops a physical column from the collection table (Requires SQLite 3.35.0+)"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    coll = cursor.execute('SELECT table_name, schema_json FROM collections WHERE id = ?', (collection_id,)).fetchone()
    if not coll:
        conn.close()
        return False
        
    table_name = coll['table_name']
    schema = json.loads(coll['schema_json'])
    
    # 1. Update Schema
    initial_len = len(schema.get('fields', []))
    schema['fields'] = [f for f in schema.get('fields', []) if f.get('safe_name') != safe_name or f.get('type') == 'Formula']
    
    if len(schema.get('fields', [])) == initial_len:
        conn.close()
        return False # Was not heavily matched or is a formula
        
    # 2. Alter Table
    try:
        cursor.execute(f"ALTER TABLE {table_name} DROP COLUMN {safe_name}")
    except Exception as e:
        print(f"Warning: DROP COLUMN failed. It may not be supported on this SQLite version: {e}")
        # We will continue and still remove it from the schema_json metadata layout, so it effectively disappears from UI ops.
        
    cursor.execute('UPDATE collections SET schema_json = ? WHERE id = ?', (json.dumps(schema), collection_id))
    conn.commit()
    conn.close()
    return True

def delete_collection(collection_id):
    """Drops the table, cascades deletes to nested collections, and removes it from metadata."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    coll = cursor.execute('SELECT table_name FROM collections WHERE id = ?', (collection_id,)).fetchone()
    if not coll:
        conn.close()
        return False
        
    table_name = coll['table_name']
    conn.close() # Close before recursive call
    
    # Cascade delete any databases that are children of items in this collection
    nested_db_children = get_all_nested_children_of_collection(collection_id)
    for nested_id in nested_db_children:
        delete_collection(nested_id)
    
    # Re-open connection to drop the main table and metadata
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Drop physical table
    cursor.execute(f"DROP TABLE IF EXISTS {table_name}")
    # Remove metadata
    cursor.execute('DELETE FROM collections WHERE id = ?', (collection_id,))
    
    conn.commit()
    conn.close()
    return True

def get_all_nested_children_of_collection(collection_id):
    """Helper to find all child collections recursively or directly authored by this collection."""
    conn = get_db_connection()
    # Find all collections whose parent_collection_id is this collection
    children = conn.execute('SELECT id FROM collections WHERE parent_collection_id = ?', (collection_id,)).fetchall()
    conn.close()
    return [c['id'] for c in children]

if __name__ == '__main__':
    init_db()
