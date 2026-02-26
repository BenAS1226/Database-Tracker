import subprocess, threading
from flask import Flask, jsonify, request, render_template
import database

app = Flask(__name__)

# Initialize Core DB on startup
database.init_db()

@app.route('/')
def index():
    """Serve the main frontend page."""
    return render_template('index.html')


# ----------------------------------------------------
# DB COLLECTIONS API (Managing the Tables themselves)
# ----------------------------------------------------

@app.route('/api/collections', methods=['GET'])
def get_collections():
    """Returns all user-created databases (collections)."""
    collections = database.get_collections()
    return jsonify(collections)

@app.route('/api/collections', methods=['POST'])
def create_collection():
    """
    Creates a new tracking database.
    Expects JSON: { "name": "Book Tracker", "fields": [{"name":"Author", "type":"Text"}, ...] }
    """
    data = request.get_json()
    name = data.get('name')
    fields = data.get('fields', [])
    
    if not name or not fields:
        return jsonify({'error': 'Name and fields are required'}), 400
        
    try:
        coll_id = database.create_collection(
            name, 
            fields, 
            data.get('summary_formulas'),
            data.get('parent_collection_id'),
            data.get('parent_item_id')
        )
        return jsonify({'id': coll_id, 'message': 'Collection created successfully'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/collections/<collection_id>', methods=['DELETE'])
def delete_collection(collection_id):
    """Deletes an entire collection."""
    success = database.delete_collection(collection_id)
    if success:
        return jsonify({'message': 'Collection deleted'})
    return jsonify({'error': 'Collection not found'}), 404

@app.route('/api/collections/<collection_id>/name', methods=['PUT'])
def rename_collection(collection_id):
    """Renames an entire collection (database)."""
    data = request.get_json()
    new_name = data.get('name')
    if not new_name:
        return jsonify({'error': 'New name is required'}), 400
        
    success = database.rename_collection(collection_id, new_name)
    if success:
        return jsonify({'message': 'Collection renamed'})
    return jsonify({'error': 'Failed to rename collection'}), 500

@app.route('/api/collections/<collection_id>/formulas', methods=['POST'])
def add_formula(collection_id):
    """Appends a logic formula to the tracking table schema."""
    data = request.get_json()
    if not data or 'name' not in data or 'expression' not in data:
        return jsonify({'error': 'Name and expression are required'}), 400
        
    success = database.add_formula_to_collection(collection_id, data, data.get('is_summary', False))
    if success:
        return jsonify({'message': 'Formula added successfully'}), 201
    return jsonify({'error': 'Collection not found'}), 404

@app.route('/api/collections/<collection_id>/formulas/<formula_name>', methods=['PUT'])
def update_formula(collection_id, formula_name):
    """Updates an existing formula."""
    data = request.get_json()
    is_summary = request.args.get('is_summary', 'false').lower() == 'true'
    success = database.update_formula_in_collection(collection_id, formula_name, data, is_summary)
    if success:
        return jsonify({'message': 'Formula updated successfully'})
    return jsonify({'error': 'Formula or collection not found'}), 404

@app.route('/api/collections/<collection_id>/formulas/<formula_name>', methods=['DELETE'])
def delete_formula(collection_id, formula_name):
    """Deletes an existing formula."""
    is_summary = request.args.get('is_summary', 'false').lower() == 'true'
    success = database.delete_formula_from_collection(collection_id, formula_name, is_summary)
    if success:
        return jsonify({'message': 'Formula deleted successfully'})
    return jsonify({'error': 'Formula or collection not found'}), 404

# ----------------------------------------------------
# STANDARD FIELDS API (Modifying structural physical columns)
# ----------------------------------------------------

@app.route('/api/collections/<collection_id>/fields', methods=['POST'])
def add_field(collection_id):
    """Adds a new physical column."""
    data = request.get_json()
    if not data or 'name' not in data or 'type' not in data:
        return jsonify({'error': 'Name and type are required'}), 400
    
    success = database.add_field_to_collection(collection_id, data)
    if success:
        return jsonify({'message': 'Field added successfully'}), 201
    return jsonify({'error': 'Failed to add column (safe name might already exist)'}), 400

@app.route('/api/collections/<collection_id>/fields/<field_id>', methods=['PUT'])
def update_field(collection_id, field_id):
    """Updates the display name or expression of a column."""
    data = request.get_json()
    if not data or 'name' not in data:
        return jsonify({'error': 'Name is required'}), 400
        
    success = database.update_field_in_collection(collection_id, field_id, data['name'], data.get('expression'))
    if success:
        return jsonify({'message': 'Field updated'})
    return jsonify({'error': 'Field not found'}), 404

@app.route('/api/collections/<collection_id>/fields/<field_id>', methods=['DELETE'])
def delete_field(collection_id, field_id):
    """Drops a column from the collection."""
    success = database.delete_field_from_collection(collection_id, field_id)
    if success:
        return jsonify({'message': 'Field dropped'})
    return jsonify({'error': 'Field not found'}), 404


# ----------------------------------------------------
# ITEMS API (Managing the Rows inside a Table)
# ----------------------------------------------------

def _get_table_metadata(collection_id):
    """Helper to fetch the physical table_name and schema for a collection."""
    conn = database.get_db_connection()
    coll = conn.execute('SELECT table_name, schema_json FROM collections WHERE id = ?', (collection_id,)).fetchone()
    conn.close()
    
    if not coll:
        return None, None
        
    import json
    return coll['table_name'], json.loads(coll['schema_json'])

@app.route('/api/collections/<collection_id>/items', methods=['GET'])
def get_items(collection_id):
    """Returns all items inside a specific collection, computing formulas dynamically."""
    table_name, schema = _get_table_metadata(collection_id)
    if not table_name:
        return jsonify({'error': 'Collection not found'}), 404
        
    conn = database.get_db_connection()
    try:
        items = conn.execute(f'SELECT * FROM {table_name} ORDER BY created_at DESC').fetchall()
        items_list = [dict(ix) for ix in items]
        
        display_map = {f.get('name'): f.get('safe_name') for f in schema.get('fields', [])}
        display_map_lower = {k.lower(): v for k, v in display_map.items()}
        
        def to_camel_case(s):
            import re
            s = re.sub(r'[^a-zA-Z0-9 ]', ' ', s).strip()
            parts = s.split()
            if not parts: return s
            return parts[0].lower() + ''.join(p.capitalize() for p in parts[1:])

        def _normalize(s):
            import re
            return re.sub(r'[^a-zA-Z0-9]', '', s).lower()

        class SmartRow(dict):
            def __init__(self, data, schema_fields, all_rows=None):
                super().__init__(data)
                self._fields = schema_fields
                self._all_rows = all_rows
                self._evaluating = set() # For cycle detection
                
                # Maps for robust lookups
                self._d_map = {f.get('name'): f.get('safe_name') for f in schema_fields}
                self._d_map_norm = {_normalize(f.get('name')): f.get('safe_name') for f in schema_fields}
                self._type_map = {f.get('safe_name'): f for f in schema_fields}

            def _resolve_key(self, name):
                if name in self._d_map: return self._d_map[name]
                norm = _normalize(name)
                return self._d_map_norm.get(norm, name)

            def __getattr__(self, name):
                return self[name]

            def __getitem__(self, key):
                safe_key = self._resolve_key(key)
                val = dict.get(self, safe_key)
                field_meta = self._type_map.get(safe_key)
                
                if field_meta:
                    if field_meta.get('type') == 'Formula' and val is None:
                        if safe_key in self._evaluating:
                            return "Err: Circular reference"
                        self._evaluating.add(safe_key)
                        try:
                            expr = field_meta.get('expression', '')
                            if expr:
                                env = {
                                    "row": self,
                                    "rows": self._all_rows or RowList([], []),
                                    "sum": sum, "len": len, "max": max, "min": min, "round": round,
                                    "__builtins__": {}
                                }
                                val = eval(expr, {"__builtins__": {}}, env)
                                self[safe_key] = val
                            else:
                                val = ""
                        except Exception as e:
                            val = f"Err: {e}"
                        finally:
                            self._evaluating.remove(safe_key)

                    if field_meta.get('type') == 'Number' and val is None:
                        return 0
                    if field_meta.get('type') == 'NestedDatabase' and val:
                        return NestedProxy(val)
                    if field_meta.get('type') == 'Relation':
                        return RelationProxy(field_meta.get('target_collection_id'), val)
                return val

        class RowList(list):
            def __init__(self, items, schema_fields=None, summary_formulas=None):
                if schema_fields:
                    items = [SmartRow(i, schema_fields) if not isinstance(i, SmartRow) else i for i in items]
                super().__init__(items)
                self._fields = schema_fields or []
                self._summaries = summary_formulas or []
                if schema_fields:
                    for item in self:
                        item._all_rows = self
                        
                # Maps for robust lookups
                self._d_map = {f.get('name'): f.get('safe_name') for f in self._fields}
                self._d_map_norm = {_normalize(f.get('name')): f.get('safe_name') for f in self._fields}
                
                self._s_map = {s.get('name'): s.get('expression') for s in self._summaries}
                self._s_map_norm = {_normalize(s.get('name')): s.get('expression') for s in self._summaries}

            def sort(self, by, ascending=True):
                safe_by = self._resolve_attr_to_key(by)
                def safe_sort_key(x):
                    val = x[safe_by] if safe_by else x.get(by)
                    if val is None:
                        return (0, "")
                    if isinstance(val, (int, float)):
                        return (1, val)
                    return (2, str(val))
                return RowList(sorted(self, key=safe_sort_key, reverse=not ascending), self._fields, self._summaries)

            def filter(self, condition):
                return RowList([x for x in self if condition(x)], self._fields, self._summaries)

            def _resolve_attr_to_key(self, name):
                if name in self._d_map: return self._d_map[name]
                norm = _normalize(name)
                return self._d_map_norm.get(norm)

            def index(self, value):
                for i, item in enumerate(self):
                    if item == value:
                        return i
                return -1
                
            def __getattr__(self, name):
                # 1. Check columns
                target_key = self._resolve_attr_to_key(name)
                if target_key:
                    return [x[target_key] for x in self]
                
                # 2. Check summary formulas
                norm = _normalize(name)
                expr = self._s_map.get(name)
                if not expr:
                    expr = self._s_map_norm.get(norm)
                
                if expr:
                    try:
                        env = {
                            "rows": self,
                            "sum": sum, "len": len, "max": max, "min": min, "round": round,
                            "__builtins__": {}
                        }
                        return eval(expr, {"__builtins__": {}}, env)
                    except Exception as e:
                        return f"Err: {e}"
                
                raise AttributeError(f"'RowList' object has no attribute '{name}'")

        class NestedProxy(RowList):
            def __init__(self, nested_id):
                t_name, t_schema = _get_table_metadata(nested_id)
                if not t_name:
                    super().__init__([])
                    return
                
                inner_conn = database.get_db_connection()
                try:
                    inner_items = inner_conn.execute(f'SELECT * FROM {t_name}').fetchall()
                    inner_items_list = [dict(ix) for ix in inner_items]
                finally:
                    inner_conn.close()
                
                super().__init__(inner_items_list, t_schema.get('fields', []), t_schema.get('summary_formulas', []))

        class RelationProxy:
            def __init__(self, target_collection_id, target_item_id):
                self.target_collection_id = target_collection_id
                self.target_item_id = target_item_id
                self._smart_row = None

            def _ensure_loaded(self):
                if self._smart_row is not None:
                    return
                t_name, t_schema = _get_table_metadata(self.target_collection_id)
                if not t_name:
                    self._smart_row = SmartRow({}, [])
                    return
                
                if self.target_item_id is None:
                    # Return an empty SmartRow with the correct schema to allow safe property access (e.g. .Calories -> 0)
                    self._smart_row = SmartRow({}, t_schema.get('fields', []))
                    return

                conn = database.get_db_connection()
                try:
                    res = conn.execute(f'SELECT * FROM {t_name} WHERE id = ?', (self.target_item_id,)).fetchone()
                    data = dict(res) if res else {}
                    self._smart_row = SmartRow(data, t_schema.get('fields', []))
                finally:
                    conn.close()

            def __getattr__(self, name):
                self._ensure_loaded()
                return getattr(self._smart_row, name)

            def __getitem__(self, key):
                self._ensure_loaded()
                return self._smart_row[key]

            def __repr__(self):
                return f"<RelationProxy {self.target_collection_id}:{self.target_item_id}>"

        wrapped_rows = RowList(items_list, schema.get('fields', []), schema.get('summary_formulas', []))

        
        # 1. Evaluate Row-level formulas (triggered by lazy-loading)
        formula_fields = [f for f in schema.get('fields', []) if f.get('type') == 'Formula']
        if formula_fields:
            for ff in formula_fields:
                for row in wrapped_rows:
                    # Accessing the field triggers calculation if not already done
                    _ = row[ff['name']]
                            
        # 2. Evaluate Database Summary Formulas
        summaries = []
        summary_defs = schema.get('summary_formulas', [])
        for sdf in summary_defs:
            expr = sdf.get('expression', '')
            val = None
            if expr:
                try:
                    val = eval(expr, {"__builtins__": {}}, {"rows": wrapped_rows, "sum": sum, "len": len, "max": max, "min": min, "round": round})
                except Exception as eval_err:
                    val = f"Err: {eval_err}"
            summaries.append({
                'name': sdf.get('name', 'Summary'),
                'value': val,
                'expression': expr
            })
            
        return jsonify({
            'items': wrapped_rows, # Return the smart rows
            'summaries': summaries
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/collections/<collection_id>/items', methods=['POST'])
def add_item(collection_id):
    """Creates a new tracked item inside a collection."""
    table_name, schema = _get_table_metadata(collection_id)
    if not table_name:
        return jsonify({'error': 'Collection not found'}), 404
        
    data = request.get_json()
    
    # Dynamically build the INSERT query based on the fields sent
    # We only insert fields that belong to the schema, plus the built-in recurrence/time fields
    valid_fields = [f['safe_name'] for f in schema['fields'] if f.get('type') != 'Formula'] + ['recurrence_rule', 'recurrence_end_date', 'recurrence_days', 'end_date_time', 'is_all_day']
    
    columns = []
    values = []
    placeholders = []
    
    for key, val in data.items():
        if key in valid_fields:
            columns.append(key)
            values.append(val)
            placeholders.append("?")
            
    if not columns:
        return jsonify({'error': 'No valid fields provided'}), 400
        
    # Uniqueness check for the 'Title' field (assumed to be the first field in schema)
    title_field = schema['fields'][0]['safe_name'] if schema.get('fields') else None
    if title_field and title_field in data:
        title_val = data[title_field]
        exists_conn = database.get_db_connection()
        try:
            exists = exists_conn.execute(f"SELECT 1 FROM {table_name} WHERE {title_field} = ?", (title_val,)).fetchone()
            if exists:
                return jsonify({'error': f"An entry with the title '{title_val}' already exists."}), 400
        finally:
            exists_conn.close()

    query = f"INSERT INTO {table_name} ({', '.join(columns)}) VALUES ({', '.join(placeholders)})"
    
    conn = database.get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(query, tuple(values))
        conn.commit()
        new_id = cursor.lastrowid
        return jsonify({'id': new_id, 'message': 'Item created successfully'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/collections/<collection_id>/items/<int:item_id>', methods=['PUT'])
def update_item(collection_id, item_id):
    """Updates an existing tracked item dynamically."""
    table_name, schema = _get_table_metadata(collection_id)
    if not table_name:
        return jsonify({'error': 'Collection not found'}), 404
        
    data = request.get_json()
    valid_fields = [f['safe_name'] for f in schema['fields'] if f.get('type') != 'Formula'] + ['recurrence_rule', 'recurrence_end_date', 'recurrence_days', 'end_date_time', 'is_all_day']
    
    updates = []
    values = []
    
    for key, val in data.items():
        if key in valid_fields:
            updates.append(f"{key} = ?")
            values.append(val)
            
    if not updates:
        return jsonify({'error': 'No valid fields provided to update'}), 400

    # Uniqueness check for the 'Title' field (assumed to be the first field in schema)
    title_field = schema['fields'][0]['safe_name'] if schema.get('fields') else None
    if title_field and title_field in data:
        title_val = data[title_field]
        exists_conn = database.get_db_connection()
        try:
            # Check specifically if ANOTHER item has this title
            exists = exists_conn.execute(f"SELECT 1 FROM {table_name} WHERE {title_field} = ? AND id != ?", (title_val, item_id)).fetchone()
            if exists:
                return jsonify({'error': f"An entry with the title '{title_val}' already exists elsewhere in this collection."}), 400
        finally:
            exists_conn.close()
        
    values.append(item_id)
    query = f"UPDATE {table_name} SET {', '.join(updates)} WHERE id = ?"
    
    conn = database.get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(query, tuple(values))
        conn.commit()
        if cursor.rowcount == 0:
            return jsonify({'error': 'Item not found'}), 404
            
        # Sync nested database names if the title changed
        if title_field and title_field in data:
            new_title = data[title_field]
            nested_db = database.get_nested_collections(item_id)
            for db in nested_db:
                database.rename_collection(db['id'], new_title)
                
        return jsonify({'message': 'Item updated successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/collections/<collection_id>/items/<int:item_id>', methods=['DELETE'])
def delete_item(collection_id, item_id):
    """Deletes an item from the collection."""
    table_name, _ = _get_table_metadata(collection_id)
    if not table_name:
        return jsonify({'error': 'Collection not found'}), 404
        
    # Cascade delete any databases that belong to this item
    nested_db = database.get_nested_collections(item_id)
    for db in nested_db:
        database.delete_collection(db['id'])
        
    conn = database.get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(f"DELETE FROM {table_name} WHERE id = ?", (item_id,))
        conn.commit()
        if cursor.rowcount == 0:
            return jsonify({'error': 'Item not found'}), 404
        return jsonify({'message': 'Item deleted successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/items/<int:item_id>/nested', methods=['GET'])
def get_nested_databases(item_id):
    """Fetches all databases nested inside a specific item."""
    colls = database.get_nested_collections(item_id)
    return jsonify(colls)

@app.route('/api/calendar/items', methods=['GET'])
def get_global_calendar():
    """
    Scans all databases, finds the date field (or created_at), 
    and returns a unified array of items to plot on the Global Calendar.
    """
    conn = database.get_db_connection()
    try:
        collections = database.get_collections()
        calendar_events = []
        
        for coll in collections:
            table_name = coll['table_name']
            schema = coll['schema']
            
            # Find an explicit Date field to use
            date_field = None
            for f in schema.get('fields', []):
                if f['type'] == 'DateTime':
                    date_field = f['safe_name']
                    break
            
            if not date_field:
                continue

            # Title field is usually the first field
            title_field = 'id'
            if schema.get('fields'):
                title_field = schema['fields'][0]['safe_name']
                
            query = f"SELECT id, recurrence_rule, recurrence_end_date, recurrence_days, end_date_time, is_all_day, {title_field} as title, {date_field} as date_val FROM {table_name}"
            try:
                rows = conn.execute(query).fetchall()
                for row in rows:
                    if row['date_val']:
                        calendar_events.append({
                            'id': row['id'],
                            'collection_id': coll['id'],
                            'collection_name': coll['name'],
                            'title': row['title'],
                            'date': row['date_val'],
                            'recurrence_rule': row['recurrence_rule'] if 'recurrence_rule' in row.keys() else 'NONE',
                            'recurrence_end_date': row['recurrence_end_date'] if 'recurrence_end_date' in row.keys() else None,
                            'recurrence_days': row['recurrence_days'] if 'recurrence_days' in row.keys() else None,
                            'end_date_time': row['end_date_time'] if 'end_date_time' in row.keys() else None,
                            'is_all_day': row['is_all_day'] if 'is_all_day' in row.keys() else 0,
                        })
            except Exception as table_err:
                print(f"Skipping table {table_name} for calendar: {table_err}")
                
        return jsonify(calendar_events)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

if __name__ == '__main__':
    remote = input('Go Remote? (y/N): ').lower() == 'y'
    if remote:
        threading.Thread(target=lambda: subprocess.run(['ngrok', 'http', '5000'])).start()
    app.run(host='0.0.0.0', port=5000, debug=not remote)