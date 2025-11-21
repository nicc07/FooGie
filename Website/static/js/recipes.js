class RecipeManager {
  constructor() {
    this.form = document.getElementById("recipe-form");
    this.recipesContainer = document.getElementById("recipes-container");
    this.loadingState = document.getElementById("loading");
    this.emptyState = document.getElementById("empty-state");
    this.calorieTracker = window.calorieTracker;
    this.BIN_ID = "68fd3d3c43b1c97be980b98b"; // TEST_BIN_ID - change to production as needed

    // Wait for calorie tracker to be ready
    if (!this.calorieTracker) {
      console.warn('Calorie tracker not immediately available, waiting...');
      setTimeout(() => {
        this.calorieTracker = window.calorieTracker;
        this.displayCalorieSummary();
      }, 100);
    } else {
      this.displayCalorieSummary();
    }

    this.initEventListeners();
  }

  initEventListeners() {
    this.form.addEventListener("submit", (e) => this.handleSubmit(e));
  }

  displayCalorieSummary() {
    // Remove existing banner if present
    const existingBanner = document.querySelector('.calorie-summary-banner');
    if (existingBanner) {
      existingBanner.remove();
    }

    if (!this.calorieTracker) {
      console.warn('Calorie tracker not available for summary display');
      return;
    }

    const summary = this.calorieTracker.getSummary();
    const settings = JSON.parse(localStorage.getItem('foogie-settings') || '{}');
    
    if (settings.showCalorieProgress === false) {
      console.log('Calorie progress display disabled in settings');
      return;
    }

    const summaryDiv = document.createElement("div");
    summaryDiv.className = "calorie-summary-banner";
    summaryDiv.innerHTML = `
      <div class="calorie-banner-content">
        <div class="calorie-stat">
          <span class="stat-label">Daily Goal</span>
          <span class="stat-value">${summary.goal} cal</span>
        </div>
        <div class="calorie-stat">
          <span class="stat-label">Consumed</span>
          <span class="stat-value ${summary.isOverGoal ? 'over-goal' : ''}">${summary.consumed} cal</span>
        </div>
        <div class="calorie-stat highlight">
          <span class="stat-label">Remaining</span>
          <span class="stat-value ${summary.isOverGoal ? 'over-goal' : ''}">${summary.remaining} cal</span>
        </div>
        <div class="calorie-stat">
          <span class="stat-label">Per Meal (${summary.mealsLeft} left)</span>
          <span class="stat-value">${summary.caloriesPerMeal} cal</span>
        </div>
      </div>
      <div class="calorie-progress-bar">
        <div class="progress-fill" style="width: ${Math.min(summary.percentConsumed, 100)}%"></div>
      </div>
    `;

    const mainCard = document.querySelector("main .card");
    if (mainCard) {
      mainCard.parentNode.insertBefore(summaryDiv, mainCard);
      console.log('Calorie summary banner displayed:', summary);
    }
  }

  async handleSubmit(e) {
    e.preventDefault();

    const formData = new FormData(this.form);
    
    let targetCaloriesPerMeal = 500;
    
    if (this.calorieTracker) {
      const summary = this.calorieTracker.getSummary();
      targetCaloriesPerMeal = summary.caloriesPerMeal || 500;
      console.log('Using target calories per meal:', targetCaloriesPerMeal);
    }

    const requestData = {
      num_recipes: parseInt(formData.get("num_recipes")),
      dietary_restrictions: formData.get("dietary_restrictions").trim(),
      cuisine_preference: formData.get("cuisine_preference").trim(),
      target_calories_per_meal: targetCaloriesPerMeal
    };

    this.showLoading();

    try {
      const response = await fetch("/api/generate-recipes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestData)
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error && (data.error.includes("No inventory") || data.error.includes("empty"))) {
          this.showEmptyState();
          return;
        }
        throw new Error(data.error || "Failed to generate recipes");
      }

      if (!data.recipes || data.recipes.length === 0) {
        this.showEmptyState();
        return;
      }

      this.renderRecipes(data.recipes);
    } catch (error) {
      console.error("Error generating recipes:", error);
      this.hideLoading();
      this.recipesContainer.innerHTML = `
        <div class="result error">
          <p><strong>Error:</strong> ${error.message}</p>
        </div>
      `;
    }
  }

  /**
   * Parse inventory items from the recipe to extract item names and quantities
   * Example input: "2 items of banana (182 cal from 2 × 91 cal per item, 0g protein, 46g carbs, 0g fats)"
   * Returns: {name: "banana", quantity: 2, unit: "items"}
   */
  parseInventoryItem(itemString) {
    console.log('Parsing inventory item:', itemString);
    
    // Try to match pattern: "X unit of name (nutrition...)"
    // Make regex more flexible to handle various formats
    const match = itemString.match(/^(\d+(?:\.\d+)?)\s+(items?|grams?|containers?|eggs?)\s+(?:of\s+)?([a-zA-Z\s]+?)(?:\s*\(|$)/i);
    
    if (match) {
      const parsed = {
        name: match[3].trim().toLowerCase(),
        quantity: parseFloat(match[1]),
        unit: match[2].toLowerCase().replace(/s$/, '') // Remove plural 's'
      };
      console.log('Successfully parsed:', parsed);
      return parsed;
    }
    
    // Fallback: try to extract just quantity and name (without unit specified)
    const simpleMatch = itemString.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z\s]+?)(?:\s*\(|$)/i);
    if (simpleMatch) {
      const parsed = {
        name: simpleMatch[2].trim().toLowerCase(),
        quantity: parseFloat(simpleMatch[1]),
        unit: 'item' // default singular
      };
      console.log('Parsed with fallback:', parsed);
      return parsed;
    }
    
    console.warn('Could not parse inventory item:', itemString);
    return null;
  }

  /**
   * Extract consumption data from recipe
   */
  extractConsumptionData(recipe) {
    const consumedMap = {};
    const inventoryItems = recipe.inventory_items_used || [];
    
    console.log('Extracting consumption from recipe:', recipe.name);
    console.log('Inventory items to parse:', inventoryItems);
    
    inventoryItems.forEach((itemString, index) => {
      const parsed = this.parseInventoryItem(itemString);
      if (parsed) {
        // Use the food name as key (lowercase for consistency)
        const key = parsed.name;
        
        console.log(`Item ${index + 1}: ${key} = ${parsed.quantity} ${parsed.unit}`);
        
        // If already exists, add to it
        if (consumedMap[key]) {
          console.log(`  Adding to existing: ${consumedMap[key]} + ${parsed.quantity}`);
          consumedMap[key] += parsed.quantity;
        } else {
          consumedMap[key] = parsed.quantity;
        }
      } else {
        console.error('Failed to parse item:', itemString);
      }
    });
    
    console.log('Final consumption map:', consumedMap);
    console.log('Total items to consume:', Object.keys(consumedMap).length);
    
    return consumedMap;
  }

  renderRecipes(recipes) {
    this.hideLoading();
    this.emptyState.classList.add("hidden");
    this.recipesContainer.innerHTML = "";

    recipes.forEach((recipe, index) => {
      const recipeCard = this.createRecipeCard(recipe, index);
      this.recipesContainer.appendChild(recipeCard);
    });

    this.recipesContainer.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  createRecipeCard(recipe, index) {
    const div = document.createElement("div");
    const urgency = recipe.urgency || "low";
    div.className = `recipe-card urgency-${urgency}`;
    div.dataset.recipeData = JSON.stringify(recipe); // Store recipe data

    const inventoryItems = recipe.inventory_items_used || [];
    const additionalItems = recipe.additional_ingredients || [];
    const foodTypes = recipe.food_types_used || [];
    const nutrition = recipe.nutrition_per_serving || {};
    const servings = recipe.servings || 1;
    const totalCalories = (nutrition.calories || 0) * servings;

    const remaining = this.calorieTracker ? this.calorieTracker.getRemainingCalories() : null;
    const fitsInBudget = remaining === null || totalCalories <= remaining;

    div.innerHTML = `
      <div class="recipe-header">
        <div>
          <h3 class="recipe-title">${recipe.name || `Recipe ${index + 1}`}</h3>
          <div class="recipe-meta">
            <span class="meta-badge">
              <span>⏱️</span>
              ${recipe.cooking_time || "N/A"}
            </span>
            <span class="meta-badge">
              <span>🍽️</span>
              ${servings} serving${servings !== 1 ? 's' : ''}
            </span>
            ${foodTypes.length > 0 ? `
              <span class="meta-badge">
                <span>🎯</span>
                ${foodTypes.join(", ")}
              </span>
            ` : ''}
            ${recipe.inventory_only ? `
              <span class="meta-badge inventory-only-badge">
                <span>🏠</span>
                Fridge Only
              </span>
            ` : ''}
            ${remaining !== null ? `
              <span class="meta-badge ${fitsInBudget ? 'fits-budget' : 'over-budget'}">
                <span>${fitsInBudget ? '✅' : '⚠️'}</span>
                ${fitsInBudget ? 'Fits budget' : 'Over budget'}
              </span>
            ` : ''}
          </div>
        </div>
        <div class="urgency-section">
          <span class="urgency-badge ${urgency}">
            ${urgency === "high" ? "⚠️ Use Soon" : urgency === "medium" ? "📅 This Week" : "✅ Fresh"}
          </span>
          ${recipe.urgency_reason ? `
            <p class="urgency-reason">${this.escapeHtml(recipe.urgency_reason)}</p>
          ` : ''}
        </div>
      </div>

      ${Object.keys(nutrition).length > 0 ? `
        <div class="recipe-section">
          <h4 class="section-title">
            <span>📊</span>
            Nutrition (per serving)
          </h4>
          <div class="nutrition-grid">
            <div class="nutrition-item">
              <span class="nutrition-icon">🔥</span>
              <div class="nutrition-details">
                <span class="nutrition-value">${nutrition.calories || 0}</span>
                <span class="nutrition-label">Calories</span>
              </div>
            </div>
            <div class="nutrition-item">
              <span class="nutrition-icon">🥩</span>
              <div class="nutrition-details">
                <span class="nutrition-value">${nutrition.protein || 0}g</span>
                <span class="nutrition-label">Protein</span>
              </div>
            </div>
            <div class="nutrition-item">
              <span class="nutrition-icon">🌾</span>
              <div class="nutrition-details">
                <span class="nutrition-value">${nutrition.carbs || 0}g</span>
                <span class="nutrition-label">Carbs</span>
              </div>
            </div>
            <div class="nutrition-item">
              <span class="nutrition-icon">🥑</span>
              <div class="nutrition-details">
                <span class="nutrition-value">${nutrition.fats || 0}g</span>
                <span class="nutrition-label">Fats</span>
              </div>
            </div>
          </div>
          <div class="total-calories-banner">
            <strong>Total for all servings:</strong> ${totalCalories} calories
          </div>
        </div>
      ` : ''}

      <div class="recipe-section">
        <h4 class="section-title">
          <span>🥘</span>
          Ingredients
        </h4>
        <div class="ingredients-grid">
          ${inventoryItems.length > 0 ? `
            <div class="ingredient-group">
              <h4>From Your Fridge</h4>
              <ul class="ingredient-list">
                ${inventoryItems.map(item => `
                  <li class="from-inventory">${this.escapeHtml(item)}</li>
                `).join("")}
              </ul>
            </div>
          ` : ""}
          
          ${additionalItems.length > 0 ? `
            <div class="ingredient-group">
              <h4>Additional Items</h4>
              <ul class="ingredient-list">
                ${additionalItems.map(item => `
                  <li>${this.escapeHtml(item)}</li>
                `).join("")}
              </ul>
            </div>
          ` : ""}
        </div>
      </div>

      <div class="recipe-section">
        <h4 class="section-title">
          <span>👨‍🍳</span>
          Instructions
        </h4>
        <ol class="instructions-list">
          ${(recipe.instructions || []).map(step => `
            <li>${this.escapeHtml(step)}</li>
          `).join("")}
        </ol>
      </div>

      <div class="recipe-actions">
        <button class="btn btn-primary use-recipe-btn" data-recipe-index="${index}">
          <span>✅</span> I Made This! (Log ${totalCalories} cal & Update Fridge)
        </button>
      </div>
    `;

    const useBtn = div.querySelector('.use-recipe-btn');
    useBtn.addEventListener('click', () => this.handleUseRecipe(recipe, totalCalories, div));

    return div;
  }

  async handleUseRecipe(recipe, totalCalories, cardElement) {
    if (!this.calorieTracker) {
      alert('Calorie tracking is not available');
      return;
    }

    const nutrition = recipe.nutrition_per_serving || {};
    const servings = recipe.servings || 1;

    // Extract consumption data
    const consumedMap = this.extractConsumptionData(recipe);
    console.log('========================================');
    console.log('RECIPE USE INITIATED:', recipe.name);
    console.log('Extracted consumption data:', consumedMap);
    console.log('Number of different items to consume:', Object.keys(consumedMap).length);
    console.log('========================================');

    if (Object.keys(consumedMap).length === 0) {
      console.warn('⚠️ No inventory items to consume - this might be inventory_only: false recipe');
      
      // Still allow logging the meal even if no inventory items
      if (!confirm('No inventory items found to consume. Continue logging the meal anyway?')) {
        return;
      }
    }

    try {
      // Show loading state
      const useBtn = cardElement.querySelector('.use-recipe-btn');
      useBtn.innerHTML = '<span>⏳</span> Processing...';
      useBtn.disabled = true;

      // 1. Consume items from fridge
      if (Object.keys(consumedMap).length > 0) {
        console.log('📦 Sending consumption request to server...');
        console.log('Bin ID:', this.BIN_ID);
        console.log('Payload:', JSON.stringify({ consumed: consumedMap }, null, 2));
        
        const consumeResponse = await fetch(`/api/consume/${this.BIN_ID}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ consumed: consumedMap })
        });

        if (!consumeResponse.ok) {
          const errorData = await consumeResponse.json();
          console.error('❌ Server error:', errorData);
          throw new Error(`Failed to update fridge: ${errorData.error || 'Unknown error'}`);
        }

        const consumeData = await consumeResponse.json();
        console.log('✅ Fridge updated successfully:', consumeData);
        console.log('Items consumed:', Object.entries(consumedMap).map(([name, qty]) => `${qty}x ${name}`).join(', '));
      } else {
        console.log('⏭️ Skipping fridge update (no items to consume)');
      }

      // 2. Log the meal to calorie tracker
      console.log('📊 Logging meal to calorie tracker...');
      await this.calorieTracker.logMeal(recipe.name, totalCalories, {
        protein: (nutrition.protein || 0) * servings,
        carbs: (nutrition.carbs || 0) * servings,
        fats: (nutrition.fats || 0) * servings,
        servings: servings
      });
      console.log('✅ Meal logged successfully');

      // 3. Update the card to show it's been used
      cardElement.classList.add('recipe-used');
      useBtn.innerHTML = '<span>✅</span> Logged & Fridge Updated!';
      useBtn.disabled = true;

      // 4. Show success message
      const summary = this.calorieTracker.getSummary();
      const message = document.createElement('div');
      message.className = 'result success';
      message.style.marginTop = '1rem';
      
      const consumedText = Object.keys(consumedMap).length > 0 
        ? `<p>🗄️ Fridge updated: ${Object.entries(consumedMap).map(([name, qty]) => `${qty} ${name}`).join(', ')} removed</p>`
        : '<p>🗄️ No fridge items consumed</p>';
      
      message.innerHTML = `
        <p><strong>✅ Success!</strong></p>
        <p>🍽️ Meal logged: ${totalCalories} calories</p>
        ${consumedText}
        <p>📊 Remaining today: ${summary.remaining} cal (${summary.mealsLeft} meals left = ~${summary.caloriesPerMeal} cal/meal)</p>
      `;
      cardElement.appendChild(message);

      console.log('🎉 Recipe completed successfully');
      console.log('Summary:', summary);
      console.log('========================================\n');

      // 5. Refresh the calorie summary banner
      this.displayCalorieSummary();

      // 6. Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (error) {
      console.error('❌ Error processing recipe:', error);
      console.error('Stack trace:', error.stack);
      
      // Reset button on error
      const useBtn = cardElement.querySelector('.use-recipe-btn');
      useBtn.innerHTML = '<span>❌</span> Error - Try Again';
      useBtn.disabled = false;
      
      alert(`Failed to process recipe: ${error.message}\n\nPlease check the console for details and try again.`);
    }
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  showLoading() {
    this.loadingState.classList.remove("hidden");
    this.recipesContainer.innerHTML = "";
    this.emptyState.classList.add("hidden");
  }

  hideLoading() {
    this.loadingState.classList.add("hidden");
  }

  showEmptyState() {
    this.hideLoading();
    this.recipesContainer.innerHTML = "";
    this.emptyState.classList.remove("hidden");
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing recipe manager');
  window.recipeManager = new RecipeManager();
});