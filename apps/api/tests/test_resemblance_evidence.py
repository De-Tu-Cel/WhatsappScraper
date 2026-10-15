"""Rangos no debe inventar atención humana (Colombia, 2026-10-14)."""
import json
from unittest.mock import Mock

import pytest
from app import classifier


def evaluate(items, thread):
    trace = []
    result = classifier._validated_parecidos(json.dumps({'parecidos': items}), thread, trace)
    return result, trace


def mixed(category='automatico_humano', **evidence):
    return dict(category=category, min=70, max=85, **evidence)


@pytest.mark.parametrize('category', ['automatico_humano', 'bot_humano'])
def test_single_welcome_cannot_prove_both_stages(category):
    welcome = 'Bienvenido. Déjanos tus datos y un asesor te atenderá.'
    result, trace = evaluate([mixed(category, evidencia_automatica='Bienvenido',
                                   evidencia_humana='un asesor te atenderá')],
                             '[Prospecto [6 s]]: ' + welcome)
    assert result == [] and trace[-1]['paso'] == 'Parecido sin evidencia suficiente'


@pytest.mark.parametrize('human', ['Yo te ayudo con tu pedido', '¿Me pueden ayudar?'])
def test_invented_or_customer_quote_does_not_prove_human_takeover(human):
    result, _ = evaluate([mixed(evidencia_automatica='Bienvenido', evidencia_humana=human)],
        '[Prospecto]: Bienvenido\n[Representante]: ¿Me pueden ayudar?')
    assert result == []


def test_evidence_must_follow_the_automatic_stage():
    result, _ = evaluate([mixed(evidencia_automatica='Bienvenido', evidencia_humana='Soy Ana')],
                         '[Prospecto]: Soy Ana\n[Prospecto]: Bienvenido')
    assert result == []


def test_repeated_same_welcome_is_not_evidence_of_a_takeover():
    result, _ = evaluate([mixed(evidencia_automatica='Bienvenido', evidencia_humana='Bienvenido')],
                         '[Prospecto]: Bienvenido\n[Prospecto]: Bienvenido')
    assert result == []


def test_only_literal_business_observations_are_shown_in_trace():
    trace = []
    raw = json.dumps({'observaciones': {'bienvenida': 'Bienvenido', 'flujo_fijo': 'Elige 1 o 2',
                                      'relevo_humano': 'Respuesta inventada'},
                      'parecidos': [{'category': 'bot', 'min': 85, 'max': 95}]})
    classifier._validated_parecidos(raw, '[Prospecto]: Bienvenido. Elige 1 o 2', trace)
    assert [step['paso'] for step in trace] == ['Aviso inicial', 'Flujo fijo']


@pytest.mark.parametrize('category,expected', [('automatico_humano', 'automatico'),
                                             ('bot_humano', 'hibrido_bot')])
def test_real_takeover_keeps_independent_range_and_evidence(category, expected):
    result, trace = evaluate([mixed(category, evidencia_automatica='Bienvenido',
                                   evidencia_humana='Soy Ana,\n reviso tu pedido')],
        '[Prospecto [5 s]]: Bienvenido\nDéjanos tus datos\n'
        '[Representante]: Hola\n[Prospecto [5 min]]: Soy Ana, reviso tu pedido')
    assert result[0] == dict(category=expected, is_ai=False, min=70, max=85, pct=78)
    assert trace[-1]['paso'] == 'Evidencia del relevo humano'


def test_dropping_unsupported_option_does_not_force_official_category_or_change_ranges():
    result, _ = evaluate([mixed(), dict(category='bot', min=40, max=60)], '[Prospecto]: Elige 1 o 2')
    assert result == [dict(category='bot', is_ai=False, min=40, max=60, pct=50)]


@pytest.mark.parametrize('raw', ['null', '[]', '{"parecidos":null}', 'not JSON'])
def test_invalid_output_fails_closed(raw):
    assert classifier._validated_parecidos(raw, '[Prospecto]: Hola', []) == []


def test_score_marks_unsupported_only_result_retryable_without_inventing_replacement(monkeypatch):
    monkeypatch.setattr(classifier, 'MongoDBManager', lambda: Mock(get_classifier_notes=lambda: {}))
    monkeypatch.setattr(classifier, '_call_deepseek', lambda *args, **kwargs:
                        json.dumps({'parecidos': [mixed()]}))
    result = classifier.score_parecido('[Prospecto]: Bienvenido, un asesor te atenderá')
    assert result['items'] == [] and result['error'] is True
