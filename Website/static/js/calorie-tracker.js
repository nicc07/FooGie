// Calorie Tracker Module
class CalorieTracker {
  constructor() {
    this.storageKey = 'foogie-calorie-log';
    this.settings = this.loadSettings();
    this.initializeDailyLog();
    console.log('CalorieTracker initialized with settings:', this.settings);
  }

  loadSettings() {
    const settings = JSON.parse(localStorage.getItem('foogie-settings') || '{}');
    const loaded = {
      dailyCalories: parseInt(settings.dailyCalories) || 2000,
      dailyMeals: parseInt(settings.dailyMeals) || 3,
      showCalorieProgress: settings.showCalorieProgress !== false
    };
    console.log('Loaded settings:', loaded, 'from storage:', settings);
    return loaded;
  }

  initializeDailyLog() {
    const today = new Date().toDateString();
    const log = this.getLog();

    // Reset log if it's a new day
    if (log.date !== today) {
      console.log('New day detected, resetting log. Old date:', log.date, 'New date:', today);
      this.resetLog();
    } else {
      console.log('Continuing log from today:', log);
    }
  }

  getLog() {
    const log = JSON.parse(localStorage.getItem(this.storageKey) || 'null');
    if (!log) {
      return this.createNewLog();
    }
    return log;
  }

  createNewLog() {
    const newLog = {
      date: new Date().toDateString(),
      meals: [],
      totalCalories: 0,
      totalProtein: 0,
      totalCarbs: 0,
      totalFats: 0
    };
    this.saveLog(newLog);
    console.log('Created new log:', newLog);
    return newLog;
  }

  saveLog(log) {
    localStorage.setItem(this.storageKey, JSON.stringify(log));
    console.log('Saved log to localStorage:', log);
  }

  resetLog() {
    const newLog = this.createNewLog();
    console.log('Log reset:', newLog);
    return newLog;
  }

  async logMeal(name, calories, nutritionData = {}) {
    const log = this.getLog();
    
    const meal = {
      name: name,
      calories: calories,
      protein: nutritionData.protein || 0,
      carbs: nutritionData.carbs || 0,
      fats: nutritionData.fats || 0,
      servings: nutritionData.servings || 1,
      timestamp: new Date().toISOString()
    };

    log.meals.push(meal);
    log.totalCalories += calories;
    log.totalProtein += meal.protein;
    log.totalCarbs += meal.carbs;
    log.totalFats += meal.fats;

    this.saveLog(log);
    console.log('Meal logged:', meal, 'New totals:', {
      calories: log.totalCalories,
      protein: log.totalProtein,
      carbs: log.totalCarbs,
      fats: log.totalFats
    });

    // Send to server for tracking
    try {
      const response = await fetch('/api/calorie-tracker', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          calories: calories,
          recipe_name: name
        })
      });
      const data = await response.json();
      console.log('Server response:', data);
    } catch (error) {
      console.error('Failed to sync with server:', error);
    }

    return meal;
  }

  getRemainingCalories() {
    const log = this.getLog();
    const remaining = this.settings.dailyCalories - log.totalCalories;
    return remaining;
  }

  getConsumedCalories() {
    const log = this.getLog();
    return log.totalCalories;
  }

  getMealsLeft() {
    const log = this.getLog();
    const mealsEaten = log.meals.length;
    const left = Math.max(0, this.settings.dailyMeals - mealsEaten);
    return left;
  }

  getCaloriesPerMeal() {
    const remaining = this.getRemainingCalories();
    const mealsLeft = this.getMealsLeft();
    
    // If no meals left, return 0
    if (mealsLeft === 0) return 0;
    
    // If already over calorie goal, suggest 0
    if (remaining <= 0) return 0;
    
    const perMeal = Math.round(remaining / mealsLeft);
    console.log(`Calories per meal calculation: ${remaining} remaining / ${mealsLeft} meals left = ${perMeal} cal/meal`);
    return perMeal;
  }

  getSummary() {
    const log = this.getLog();
    const remaining = this.getRemainingCalories();
    const mealsLeft = this.getMealsLeft();
    const caloriesPerMeal = this.getCaloriesPerMeal();
    const percentConsumed = (log.totalCalories / this.settings.dailyCalories) * 100;

    const summary = {
      goal: this.settings.dailyCalories,
      consumed: log.totalCalories,
      remaining: remaining,
      mealsLeft: mealsLeft,
      caloriesPerMeal: caloriesPerMeal,
      percentConsumed: Math.round(percentConsumed),
      isOverGoal: remaining < 0,
      meals: log.meals,
      nutrition: {
        protein: log.totalProtein,
        carbs: log.totalCarbs,
        fats: log.totalFats
      }
    };

    return summary;
  }

  getTodaysMeals() {
    const log = this.getLog();
    return log.meals;
  }

  deleteMeal(index) {
    const log = this.getLog();
    if (index >= 0 && index < log.meals.length) {
      const meal = log.meals[index];
      
      log.totalCalories -= meal.calories;
      log.totalProtein -= meal.protein;
      log.totalCarbs -= meal.carbs;
      log.totalFats -= meal.fats;
      
      log.meals.splice(index, 1);
      
      this.saveLog(log);
      console.log('Meal deleted at index', index, 'New log:', log);
      return true;
    }
    console.warn('Invalid meal index for deletion:', index);
    return false;
  }

  updateSettings(newSettings) {
    const oldSettings = {...this.settings};
    this.settings = {
      dailyCalories: parseInt(newSettings.dailyCalories) || this.settings.dailyCalories,
      dailyMeals: parseInt(newSettings.dailyMeals) || this.settings.dailyMeals,
      showCalorieProgress: newSettings.showCalorieProgress !== false
    };
    console.log('Settings updated from', oldSettings, 'to', this.settings);
  }
}

// Initialize global calorie tracker immediately
console.log('Initializing global calorie tracker...');
window.calorieTracker = new CalorieTracker();
console.log('Global calorie tracker initialized:', window.calorieTracker);

// Also initialize on DOMContentLoaded to ensure it's ready
document.addEventListener('DOMContentLoaded', () => {
  if (!window.calorieTracker) {
    console.warn('Calorie tracker was not initialized, creating now...');
    window.calorieTracker = new CalorieTracker();
  } else {
    console.log('Calorie tracker already initialized');
  }
});