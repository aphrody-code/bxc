import json
from bs4 import BeautifulSoup
from markdownify import markdownify as md

def clean_html_for_rag(html_content):
    """
    Nettoie le HTML pour ne garder que le contenu textuel utile.
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    
    # Supprime les éléments inutiles
    for tag in soup(['nav', 'header', 'footer', 'aside', 'script', 'style', 'ads']):
        tag.decompose()
        
    # Extrait le titre
    title = soup.title.string if soup.title else ""
    
    # Convertit en Markdown propre
    clean_html = str(soup)
    markdown_content = md(clean_html, heading_style="ATX")
    
    return {
        "title": title,
        "markdown": markdown_content.strip(),
        "text_length": len(markdown_content)
    }

def generate_simple_embedding(text):
    """
    Exemple simple (en attendant un modèle lourd)
    """
    return [len(word) for word in text.split()[:10]] # Mock embedding logic
