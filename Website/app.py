from flask import Flask, request, render_template, jsonify
from google import genai
import os
from dotenv import load_dotenv
import requests
import data
from datetime import datetime


today_date = datetime.now().strftime("%d/%m/%Y")
import json


load_dotenv()

app = Flask(__name__)
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# id for the json bin. Stores all data.
BIN_ID = "68fd49ac43b1c97be980cfb7"

# id for testing only, contains garbage.
TEST_BIN_ID = "68fd3d3c43b1c97be980b98b"


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/settings")
def settings():
    return render_template("settings.html")


@app.route("/fridge")
def fridge():
    return render_template("fridge.html")



@app.route("/recipes")
def recipes_page():
    return render_template("recipes.html")



@app.route("/api/fridge/<bin_id>")
def get_fridge_data(bin_id):
    fridge_data = data.read_data_from_bin(bin_id)
    if fridge_data:
        return jsonify(fridge_data)
    else:
        return jsonify({"error": "Failed to retrieve fridge data"}), 500


@app.route("/api/fridge/<bin_id>", methods=["PUT"])
def update_fridge_data(bin_id):
    updated_data = request.json

    url = f"{data.BASE_URL}/{bin_id}"
    headers = {"Content-Type": "application/json", "X-Master-Key": data.MASTER_KEY}

    response = requests.put(url, headers=headers, data=json.dumps(updated_data))

    try:
        response.raise_for_status()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/consume/<bin_id>", methods=["POST"])
def consume_items(bin_id):
    """
    Consume items from inventory when a recipe is made.
    Expects JSON: {"consumed": {"apple": 2, "chicken": 200}}
    """
    try:
        consumed_data = request.get_json()
        
        if not consumed_data or "consumed" not in consumed_data:
            return jsonify({"error": "No consumption data provided"}), 400
        
        consumed_map = consumed_data["consumed"]
        
        if not consumed_map:
            return jsonify({"error": "Empty consumption map"}), 400
        
        print(f"Processing consumption for bin {bin_id}: {consumed_map}")
        
        # Use the data.py consume function
        data.consume_data_from_bin(bin_id, consumed_map)
        
        # Return the updated inventory
        updated_data = data.read_data_from_bin(bin_id)
        
        return jsonify({
            "success": True,
            "message": "Items consumed successfully",
            "inventory": updated_data
        })
        
    except Exception as e:
        print(f"Error consuming items: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route("/api/generate-recipes", methods=["POST"])
def generate_recipes():
    """Generate recipe recommendations based on inventory, prioritizing expiring items"""
    try:
        # Read inventory from bin
        inventory_data = data.read_data_from_bin(
            TEST_BIN_ID
        )  # Change to BIN_ID for actual use

        if not inventory_data or "inventory" not in inventory_data:
            return jsonify({"error": "No inventory found"}), 400

        items = inventory_data["inventory"]

        if not items:
            return jsonify({"error": "Inventory is empty"}), 400

        # Sort by expiry date (earliest first)
        from datetime import datetime

        def parse_date(item):
            try:
                return datetime.strptime(
                    item.get("expected_expiry_date", "31/12/2099"), "%d/%m/%Y"
                )
            except:
                return datetime.max

        sorted_items = sorted(items, key=parse_date)

        # Analyze inventory diversity by type
        type_counts = {}
        for item in sorted_items:
            item_type = item.get("type", "other")
            type_counts[item_type] = type_counts.get(item_type, 0) + 1

        available_types = list(type_counts.keys())

        # Create a formatted inventory list for Gemini with CORRECTED nutritional info
        inventory_text = (
            "Current Inventory (sorted by expiry date - USE EARLIEST EXPIRING FIRST):\n"
        )
        for i, item in enumerate(sorted_items, 1):
            days_until_expiry = "Unknown"
            try:
                exp_date = datetime.strptime(
                    item.get("expected_expiry_date", ""), "%d/%m/%Y"
                )
                days = (exp_date - datetime.now()).days
                days_until_expiry = (
                    f"{days} days" if days > 0 else "EXPIRED" if days < 0 else "TODAY"
                )
            except:
                pass

            # Get unit and quantity for calculations
            unit = item.get('unit', 'units')
            quantity = item.get('quantity', 1)
            
            # CRITICAL: Calculate per-unit nutrition
            # The stored values are TOTAL for all items, so divide by quantity
            total_calories = item.get('calories', 0)
            total_protein = item.get('protein', 0)
            total_carbs = item.get('carbs', 0)
            total_fats = item.get('fats', 0)
            
            # Calculate per-unit values
            calories_per_unit = round(total_calories / quantity) if quantity > 0 else 0
            protein_per_unit = round(total_protein / quantity) if quantity > 0 else 0
            carbs_per_unit = round(total_carbs / quantity) if quantity > 0 else 0
            fats_per_unit = round(total_fats / quantity) if quantity > 0 else 0
            
            inventory_text += f"{i}. {item.get('name', 'Unknown').upper()} ({item.get('type', 'food')})\n"
            inventory_text += f"   - Available quantity: {quantity} {unit}\n"
            inventory_text += f"   - Expires: {item.get('expected_expiry_date', 'Unknown')} ({days_until_expiry})\n"
            inventory_text += f"   - TOTAL nutrition (for all {quantity} {unit}): {total_calories} cal, {total_protein}g protein, {total_carbs}g carbs, {total_fats}g fats\n"
            inventory_text += f"   - PER-UNIT nutrition (per 1 {unit.rstrip('s')}): {calories_per_unit} cal, {protein_per_unit}g protein, {carbs_per_unit}g carbs, {fats_per_unit}g fats\n"

        # Get user preferences if provided
        request_data = request.get_json() or {}
        dietary_restrictions = request_data.get("dietary_restrictions", "")
        cuisine_preference = request_data.get("cuisine_preference", "")
        num_recipes = request_data.get("num_recipes", 3)
        target_calories_per_meal = request_data.get("target_calories_per_meal", 500)

        # Build the prompt with nutritional and diversity requirements
        prompt = f"""{inventory_text}

Available food types in inventory: {", ".join(available_types)}

TARGET CALORIES PER MEAL: ~{target_calories_per_meal} calories (user's remaining daily budget divided by meals left)

Generate {num_recipes} diverse and nutritionally balanced recipe recommendations following these STRICT RULES:

🔴 PRIORITY RULES (MOST IMPORTANT):
1. **ALWAYS prioritize ingredients expiring soonest** (items listed first MUST be used first)
2. Items expiring in 0-3 days = CRITICAL - MUST use in recipes
3. Items expiring in 4-7 days = HIGH priority
4. Items expiring in 8+ days = MEDIUM priority

🏠 INVENTORY-ONLY REQUIREMENT:
**AT LEAST ONE recipe MUST use ONLY ingredients from the inventory (no additional ingredients except basic seasonings like salt/pepper).**
- Mark this recipe with "inventory_only": true
- For this recipe, get creative with what's available in the fridge
- You can assume basic pantry items: salt, pepper, cooking oil/butter
- NO other additional ingredients allowed for the inventory-only recipe

🥗 DIVERSITY REQUIREMENTS:
1. Each recipe MUST use ingredients from AT LEAST 2-3 different food types (e.g., protein + vegetable + grain)
2. Across all {num_recipes} recipes, try to use items from ALL available types: {", ".join(available_types)}
3. Don't create recipes using only one food type (e.g., not just fruits or just vegetables)
4. Balance macronutrients: aim for recipes with protein, carbs, and healthy fats

📊 CRITICAL NUTRITIONAL CALCULATION RULES:
**READ THIS CAREFULLY - THIS IS THE MOST IMPORTANT PART:**

1. Each inventory item shows TWO nutrition values:
   - TOTAL nutrition = for ALL units in inventory (e.g., 637 cal for 7 bananas)
   - PER-UNIT nutrition = for ONE unit (e.g., 91 cal per 1 banana)

2. **YOU MUST USE THE PER-UNIT VALUES IN YOUR CALCULATIONS!**
   - If using 2 bananas: 2 × 91 cal = 182 cal (NOT 2 × 637 = 1274 cal!)
   - If using 200 grams of chicken (per-unit is per 100g): 2 × per-unit value

3. **CALCULATION FORMULA:**
   ```
   Recipe Nutrition = Σ(quantity_used × per_unit_nutrition) + additional_ingredients_nutrition
   ```

4. **EXAMPLE CALCULATION:**
   - Recipe uses: 3 bananas + 1 cup yogurt (150 cal)
   - Banana per-unit: 91 cal, 0g protein, 23g carbs, 0g fats
   - Calculation: (3 × 91) + 150 = 273 + 150 = 423 total calories
   - Final: 423 cal, 3g protein, 69g carbs, 0g fats

5. **TARGET: Aim for recipes around {target_calories_per_meal} calories per serving**

6. Each recipe should aim for balanced macros:
   - Protein: 15-30g per serving
   - Carbs: 30-60g per serving
   - Fats: 10-25g per serving

🍳 RECIPE REQUIREMENTS:
- Use realistic quantities from inventory (don't use more than available)
- **CRITICAL: ALWAYS include the unit when specifying quantities** (e.g., "2 items of apples" or "200 grams of chicken")
- When listing inventory items used, show the nutrition calculation clearly
- Instructions should be 4-8 detailed steps
- Cooking time should be realistic (15-60 minutes)

{f"⚠️ DIETARY RESTRICTIONS: {dietary_restrictions} - STRICTLY follow these restrictions!" if dietary_restrictions else ""}
{f"🌎 CUISINE PREFERENCE: {cuisine_preference} - Try to match this style" if cuisine_preference else ""}

Format your response as a JSON array. Each recipe must include accurate nutritional calculations using PER-UNIT values:

[
  {{
    "name": "Recipe Name",
    "inventory_only": false,
    "inventory_items_used": [
      "2 items of banana (182 cal from 2 × 91 cal per item, 0g protein, 46g carbs, 0g fats)",
      "200 grams of chicken (220 cal from 2 × 110 cal per 100g, 44g protein, 0g carbs, 4g fats)"
    ],
    "additional_ingredients": ["1 cup yogurt (150 cal, 10g protein, 20g carbs, 2g fats)", "salt", "pepper"],
    "instructions": ["Step 1...", "Step 2...", "Step 3...", "Step 4..."],
    "cooking_time": "30 minutes",
    "servings": 2,
    "nutrition_per_serving": {{
      "calories": 276,
      "protein": 27,
      "carbs": 33,
      "fats": 3
    }},
    "total_nutrition": {{
      "calories": 552,
      "protein": 54,
      "carbs": 66,
      "fats": 6
    }},
    "food_types_used": ["protein", "fruit", "dairy"],
    "urgency": "high",
    "urgency_reason": "Uses bananas expiring in 6 days"
  }}
]

URGENCY LEVELS:
- "high" = uses items expiring within 3 days
- "medium" = uses items expiring within 7 days  
- "low" = uses items expiring after 7 days

⚠️ CRITICAL REMINDERS:
1. **USE PER-UNIT NUTRITION VALUES, NOT TOTAL VALUES!**
2. Show your calculation in the inventory_items_used list (e.g., "2 × 91 cal per item")
3. Always include units (items, grams, containers, eggs)
4. Double-check that your total nutrition makes sense for the quantity used
5. AT LEAST ONE recipe must have "inventory_only": true
6. AT LEAST ONE recipe must have additional items beyond seasonings
"""

        # Call Gemini API
        gemini_response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=[{"role": "user", "parts": [{"text": prompt}]}],
        )

        print("Gemini recipe response:")
        print(gemini_response.text)

        # Parse the response
        response_text = gemini_response.text.strip()

        # Remove markdown code fences if present
        if response_text.startswith("```json"):
            response_text = (
                response_text.removeprefix("```json").removesuffix("```").strip()
            )
        elif response_text.startswith("```"):
            response_text = (
                response_text.removeprefix("```").removesuffix("```").strip()
            )

        # Parse JSON
        recipes = json.loads(response_text)

        return jsonify({"recipes": recipes})

    except json.JSONDecodeError as e:
        print(f"JSON parsing error: {e}")
        return jsonify(
            {
                "error": "Failed to parse recipe data",
                "raw_response": gemini_response.text,
            }
        ), 500
    except Exception as e:
        print(f"Error generating recipes: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/calorie-tracker", methods=["GET", "POST"])
def calorie_tracker():
    """Track daily calorie consumption"""
    if request.method == "GET":
        return jsonify({"status": "ok"})

    elif request.method == "POST":
        data = request.get_json()
        calories = data.get("calories", 0)
        recipe_name = data.get("recipe_name", "Unknown")

        print(f"Logged consumption: {recipe_name} - {calories} calories")

        return jsonify(
            {
                "status": "success",
                "message": f"Logged {calories} calories from {recipe_name}",
            }
        )


@app.route("/analyze", methods=["POST"])
def analyze():
    prompt = f"""Analyze this food image and return the data as a Python dictionary. Follow these guidelines carefully:

    CRITICAL FORMATTING RULES:
    - Return ONLY valid JSON format within a Python dictionary structure
    - Use the exact field names and structure shown in the example
    - All numerical values must be integers (no decimals, no quotes)

    DATA REQUIREMENTS:

    1. NAME: Use common food names (e.g., "coca cola" not "Coca-Cola 330ml can")

    2. TYPE: Choose from: "fruit", "vegetable", "protein", "grains", "dairy", "beverage", "snacks", "condiments"

    3. QUANTITY AND UNITS:
    - quantity: Always an integer number
    - unit: Choose from these exact options:
        * "items" - for individual pieces (fruits, vegetables, packaged items)
        * "grams" - for meat, cheese, bulk foods
        * "containers" - for bottles, cans, cartons, packages
        * "eggs" - specifically for eggs

    RULES:
    - For SOLID items: count individual pieces → unit: "items" (e.g., 6 apples)
    - For LIQUIDS/BEVERAGES: count containers → unit: "containers" (e.g., 2 bottles of soda)
    - For MEAT/PROTEINS: use grams → unit: "grams" (e.g., 500g chicken)
    - For EGGS: use count → unit: "eggs" (e.g., 12 eggs)
    - NEVER use volume measurements (no ml, liters, cups, etc.)

    4. EXPIRY DATE: 
    - **TODAY'S DATE IS: {today_date} - USE THIS AS PURCHASE DATE**
    - Calculate expiry dates based on TODAY being the purchase date
    - Assume refrigerator storage for perishable items
    - Use DD/MM/YYYY format
    - Research realistic shelf life for each food type:
        * Fresh fruits: 3-7 days from today
        * Fresh vegetables: 5-10 days from today  
        * Raw meat/fish: 2-3 days from today
        * Dairy: 7-14 days from today
        * Beverages: 30-180 days from today
        * Packaged snacks: 90-365 days from today

    5. NUTRITION (per entire quantity shown):
    - calories: total calories for the quantity shown
    - carbs: total carbohydrates in grams
    - fats: total fat in grams  
    - protein: total protein in grams
    - All values must be integers representing the TOTAL for the quantity

    UNIT SPECIFIC EXAMPLES:
    - 6 apples → quantity: 6, unit: "items"
    - 2 bottles of milk → quantity: 2, unit: "containers" 
    - 500g chicken → quantity: 500, unit: "grams"
    - 12 eggs → quantity: 12, unit: "eggs"
    - 1 can of soda → quantity: 1, unit: "containers"
    - 3 bananas → quantity: 3, unit: "items"

    EXAMPLE OUTPUT FORMAT:
    {{
        "inventory": [
            {{
                "name": "orange",
                "type": "fruit", 
                "quantity": 6,
                "unit": "items",
                "expected_expiry_date": "{today_date}",
                "calories": 372,
                "carbs": 93,
                "fats": 0,
                "protein": 0
            }},
            {{
                "name": "coca cola", 
                "type": "beverage",
                "quantity": 4,
                "unit": "containers",
                "expected_expiry_date": "15/12/2025",
                "calories": 560,
                "carbs": 140,
                "fats": 0,
                "protein": 0
            }},
            {{
                "name": "chicken breast",
                "type": "protein",
                "quantity": 500,
                "unit": "grams",
                "expected_expiry_date": "05/12/2024",
                "calories": 825,
                "carbs": 0,
                "fats": 18,
                "protein": 100
            }},
            {{
                "name": "eggs",
                "type": "protein", 
                "quantity": 12,
                "unit": "eggs",
                "expected_expiry_date": "25/11/2024",
                "calories": 840,
                "carbs": 0,
                "fats": 60,
                "protein": 72
            }}
        ]
    }}

    IMPORTANT: 
    - Today's purchase date is {today_date} - calculate all expiry dates from this date
    - Be realistic with expiry dates based on common food shelf life
    - Ensure dates are chronologically logical (expiry dates must be AFTER today)
    - Use the exact unit values: "items", "grams", "containers", or "eggs" """
    image_url = request.form.get("image_url")
    image_file = request.files.get("image_file")

    print(f"DEBUG - Received image_url: {image_url}")
    print(f"DEBUG - Received image_file: {image_file}")

    parts = [{"text": prompt}]

    if image_url:
        print(f"DEBUG - Attempting to fetch URL: {image_url}")
        try:
            response = requests.get(image_url, timeout=10)
            response.raise_for_status()
            print(
                f"DEBUG - Successfully fetched image, size: {len(response.content)} bytes"
            )
            parts.append(
                {"inline_data": {"mime_type": "image/jpeg", "data": response.content}}
            )
        except Exception as e:
            print(f"DEBUG - Failed to fetch image: {str(e)}")
            return jsonify({"error": f"Failed to fetch image: {str(e)}"}), 400

    elif image_file:
        print(f"DEBUG - Processing uploaded file: {image_file.filename}")
        parts.append(
            {
                "inline_data": {
                    "mime_type": image_file.mimetype,
                    "data": image_file.read(),
                }
            }
        )
    else:
        print("DEBUG - No image provided")
        return jsonify({"error": "No image provided"}), 400

    gemini_response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=[{"role": "user", "parts": parts}],
    )
    print(gemini_response.text)

    # change TEST_BIN_ID to BIN_ID for actual use
    data.store_data_to_bin(
        data.parse_gemini_inventory_output(gemini_response.text), TEST_BIN_ID
    )

    return jsonify({"response": gemini_response.text})


if __name__ == "__main__":
    app.run(debug=True)