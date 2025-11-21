// Analyzer module - handles form submission and API communication
class FoodAnalyzer {
  constructor() {
    this.form = document.getElementById("analyze-form");
    this.resultDiv = document.getElementById("result");
    this.fileInput = document.getElementById("image_file");
    this.fileLabel = this.fileInput.nextElementSibling.querySelector('.file-input-text');
    
    this.initEventListeners();
  }

  initEventListeners() {
    this.form.addEventListener("submit", (e) => this.handleSubmit(e));
    
    // Update file input label when file is selected
    this.fileInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        this.fileLabel.textContent = e.target.files[0].name;
      } else {
        this.fileLabel.textContent = "Choose file...";
      }
    });

    // Listen for camera events
    window.addEventListener('photoCapture', (e) => {
      this.showMessage(e.detail.message, 'success');
    });

    window.addEventListener('photoRetake', () => {
      this.clearMessage();
    });
  }

  async handleSubmit(e) {
    e.preventDefault();

    const formData = new FormData();
    
    // Priority: captured photo > uploaded file > URL
    const capturedBlob = camera.getCapturedBlob();
    
    if (capturedBlob) {
      formData.append("image_file", capturedBlob, "camera-capture.jpg");
      console.log("Using captured photo");
    } else if (this.fileInput.files[0]) {
      formData.append("image_file", this.fileInput.files[0]);
      console.log("Using uploaded file");
    } else if (this.form.elements.image_url.value) {
      formData.append("image_url", this.form.elements.image_url.value);
      console.log("Using URL");
    } else {
      this.showMessage("Please provide an image (upload, URL, or camera)", 'error');
      return;
    }

    this.showMessage("⏳ Analyzing image...", 'loading');

    try {
      const res = await fetch("/analyze", {
        method: "POST",
        body: formData
      });

      const data = await res.json();
      
      if (data.response) {
        this.showMessage(`<strong>Success!</strong><br>${this.formatResponse(data.response)}`, 'success');
      } else {
        this.showMessage(`Error: ${data.error || 'Something went wrong'}`, 'error');
      }
    } catch (error) {
      console.error("Analysis error:", error);
      this.showMessage(`Error: ${error.message}`, 'error');
    }
  }

  formatResponse(response) {
    // Try to parse and format JSON response nicely
    try {
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || 
                        response.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const parsed = JSON.parse(jsonStr);
        
        let formatted = '<div style="text-align: left; margin-top: 0.5rem;">';
        
        if (parsed.calories) {
          formatted += `<div style="margin-bottom: 0.5rem;"><strong>🔥 Calories:</strong> ${parsed.calories}</div>`;
        }
        
        if (parsed.freshness || parsed.shelf_life || parsed.last) {
          const freshness = parsed.freshness || parsed.shelf_life || parsed.last;
          formatted += `<div><strong>📅 Freshness:</strong> ${freshness}</div>`;
        }
               
        formatted += '</div>';
        return formatted;
      }
    } catch (e) {
      console.log("Could not parse JSON, showing raw response");
    }
    
    // If not JSON or parsing failed, return formatted text
    return response.replace(/\n/g, '<br>');
  }

  showMessage(message, type = 'loading') {
    this.resultDiv.innerHTML = `<p>${message}</p>`;
    this.resultDiv.className = `result ${type}`;
  }

  clearMessage() {
    this.resultDiv.innerHTML = '';
    this.resultDiv.className = 'result';
  }
}

// Initialize analyzer when DOM is ready
const analyzer = new FoodAnalyzer();
